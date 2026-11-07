"""Read the Moscow retail export supplied by the Citilink partner programme."""
from datetime import datetime, timedelta, timezone
from gzip import GzipFile
from io import BytesIO
import json
import os
import re
import sys
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

MAX_BYTES = 64 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def load_feed():
    if len(sys.argv) == 2:
        with open(sys.argv[1], "rb") as source:
            return source.read(MAX_BYTES + 1)
    url = os.environ["CITILINK_MOSCOW_YML_URL"]
    parts = urlsplit(url)
    domains = ("advcake.ru", "advcake.com", "citilink.ru")
    host = parts.hostname or ""
    if (parts.scheme != "https" or parts.username or parts.password or
            parts.port or parts.fragment or not any(host == d or host.endswith("." + d) for d in domains)):
        raise ValueError("Invalid partner feed URL")
    request = Request(url, headers={"User-Agent": "DZLAB-Catalog/1.0"})
    with build_opener(NoRedirect()).open(request, timeout=35) as response:
        return response.read(MAX_BYTES + 1)


def parse_feed(data):
    if len(data) > MAX_BYTES:
        raise ValueError("Feed too large")
    if data.startswith(b"\x1f\x8b"):
        with GzipFile(fileobj=BytesIO(data)) as source:
            data = source.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or b"\x00" in data or re.search(br"<!ENTITY|<!DOCTYPE[^>]*\[", data, re.I):
        raise ValueError("Unsupported XML")
    root = ET.fromstring(data)
    if root.tag != "yml_catalog":
        raise ValueError("Expected YML")
    published = datetime.fromisoformat(root.attrib["date"].replace("Z", "+00:00"))
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone(timedelta(hours=3)))
    age = datetime.now(timezone.utc) - published
    if not timedelta(minutes=-5) <= age <= timedelta(hours=36):
        raise ValueError("Invalid feed time")
    products = root.find("shop/offers")
    if products is None:
        raise ValueError("Missing offers")
    rows = {}
    ambiguous = set()
    for offer in products.findall("offer"):
        if offer.findtext("currencyId", "").strip().upper() not in ("RUB", "RUR"):
            continue
        # Only direct product URLs expose the verified Citilink SKU. Partner
        # redirects cannot be substituted without a verified identity map.
        url = urlsplit(offer.findtext("url", "").strip())
        match = re.fullmatch(r"/product/[a-z0-9_-]+-([a-z]?\d+)/?", url.path, re.I)
        if not match or url.hostname not in ("www.citilink.ru", "citilink.ru") or url.scheme != "https":
            continue
        if url.username or url.password or url.port or offer.attrib.get("available") == "false":
            continue
        raw_price = offer.findtext("price", "").strip()
        if not re.fullmatch(r"\d{1,8}(?:\.\d{1,2})?", raw_price):
            continue
        price = float(raw_price)
        if not 0 < price <= 10_000_000:
            continue
        sku = match[1].lower()
        row = {"sku": sku, "price": price, "available": offer.attrib.get("available") == "true"}
        if sku in rows and rows[sku] != row:
            ambiguous.add(sku)
        rows[sku] = row
    return {
        "checkedAt": published.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "rows": [row for sku, row in rows.items() if sku not in ambiguous],
    }


if __name__ == "__main__":
    try:
        print(json.dumps(parse_feed(load_feed()), separators=(",", ":"), allow_nan=False))
    except (OSError, ValueError, KeyError, ET.ParseError):
        # Partner URLs may contain access tokens. Keep them out of job logs.
        sys.exit("Ситилинк: не удалось загрузить или проверить московский YML")
