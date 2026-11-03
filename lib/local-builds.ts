import type {Selection} from './catalog-types';
export const LOCAL_BUILDS_KEY = 'dz-saved-builds-v1';
export type LocalBuild = {id:string;name:string;selection:Selection;created_at:string};
export function readLocalBuilds(storage: Pick<Storage,'getItem'>): LocalBuild[] {
  const raw = storage.getItem(LOCAL_BUILDS_KEY);
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Не удалось прочитать сохранённые сборки.');
  return rows.filter((b): b is LocalBuild => !!b && typeof b === 'object' &&
    typeof b.id === 'string' && typeof b.name === 'string' && typeof b.created_at === 'string' &&
    !!b.selection && typeof b.selection === 'object' && !Array.isArray(b.selection) &&
    Object.values(b.selection).every(v => typeof v === 'string')).slice(0,100);
}
export function saveLocalBuild(storage: Pick<Storage,'getItem'|'setItem'>, build: LocalBuild) {
  const builds = [build, ...readLocalBuilds(storage).filter(b => b.id !== build.id)].slice(0,100);
  storage.setItem(LOCAL_BUILDS_KEY,JSON.stringify(builds));
  return builds;
}
