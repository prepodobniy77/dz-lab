import {createRoot} from 'react-dom/client';
import SourceAdmin from '../components/source-admin';
import Workbench from '../components/workbench';
import raw from '../data/catalog.json';
import {desktopCatalog} from '../lib/catalog-scope';
import type {CatalogData} from '../lib/catalog-types';
import '../app/globals.css';
import '../app/apple.css';

createRoot(document.getElementById('root')!).render(
  window.location.pathname==='/admin/prices'?<SourceAdmin/>:<Workbench themeSwitch initialData={{...desktopCatalog(raw as unknown as CatalogData),storage:'snapshot',signedIn:false}}/>
);
