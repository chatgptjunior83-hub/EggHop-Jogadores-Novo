import {access,readFile} from 'node:fs/promises';
const files=JSON.parse(process.env.IGNORED_CHECK||'[]');
for(const path of ['public/index.html','public/favicon.svg','netlify/functions/api.mjs','netlify.toml','package.json',...files])await access(path);
const text=await readFile('netlify/functions/api.mjs','utf8');
if(!text.includes('export default async function handler'))throw Error('Função da Netlify ausente.');
console.log('Arquivos presentes: OK.');
