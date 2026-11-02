import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async scheduled(_event: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    const {runPriceSweep}=await import("../lib/price-sweep");
    ctx.waitUntil((async()=>{try{const deadline=Date.now()+12*60000;for(let i=0;i<40&&Date.now()<deadline;i++){const result=await runPriceSweep('cron');if(result.done){if(result.report.status==='failed'||result.report.status==='blocked')console.error('Обновление цен не выполнено:',result.report.message);break}await new Promise(resolve=>setTimeout(resolve,5000))}}catch(error){const {priceSweepFailureMessage}=await import('../lib/price-job-errors');console.error('Ошибка планового обновления:',priceSweepFailureMessage(error));try{const {recordFailedSweep}=await import('../lib/price-sweep');await recordFailedSweep(error,'cron')}catch{console.error('Не удалось записать отчёт обновления цен')}}})());
  },
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
