import {createRequire} from "module";
const require = createRequire(import.meta.url);
export function findPackageRoot(name:string){
    try{
        return require.resolve(name);
    } catch {
        return null;
    }
}