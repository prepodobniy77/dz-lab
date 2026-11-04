import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  root:resolve(root,'standalone'),
  publicDir:resolve(root,'public'),
  server:{host:'127.0.0.1',watch:{useFsEvents:false,usePolling:true}},
  resolve:{alias:{'@':root}},
  define:{'process.env.NEXT_PUBLIC_LOCAL_BUILDS':JSON.stringify('1'),'process.env.NEXT_PUBLIC_SHOW_ADMIN':JSON.stringify('0')},
  build:{outDir:resolve(root,'dist/static'),emptyOutDir:true},
  plugins:[react(),{
    name:'catalog-snapshot',
    configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        const url=(req.url||'').split('?')[0];
        if(req.method!=='GET'||!['/api/catalog','/api/prices/sweep'].includes(url))return next();
        res.setHeader('Content-Type','application/json; charset=utf-8');
        if(url==='/api/prices/sweep')return res.end(JSON.stringify({report:null}));
        try{const raw=JSON.parse(await readFile(resolve(root,'data/catalog.json'),'utf8'));res.end(JSON.stringify({...raw,storage:'snapshot'}))}
        catch{res.statusCode=500;res.end(JSON.stringify({error:'Каталог недоступен'}))}
      });
    },
    async closeBundle(){
      const out=resolve(root,'dist/static');
      await mkdir(resolve(out,'api/prices'),{recursive:true});
      const raw=JSON.parse(await readFile(resolve(root,'data/catalog.json'),'utf8'));
      await writeFile(resolve(out,'api/catalog'),JSON.stringify({...raw,storage:'snapshot'}));
      await writeFile(resolve(out,'api/prices/sweep'),JSON.stringify({report:null}));
      await writeFile(resolve(out,'_headers'),'/api/*\n  Content-Type: application/json; charset=utf-8\n  Cache-Control: no-cache\n');
    },
  }],
});
