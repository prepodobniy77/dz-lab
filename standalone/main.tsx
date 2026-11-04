import {createRoot} from 'react-dom/client';
import Workbench from '../components/workbench';
import raw from '../data/catalog.json';
import type {CatalogData} from '../lib/catalog-types';
import '../app/globals.css';
import '../app/apple.css';

createRoot(document.getElementById('root')!).render(
  <Workbench initialData={{...raw as unknown as CatalogData,storage:'snapshot',signedIn:false}}/>
);
