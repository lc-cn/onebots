import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";

/**
 * SQLite-based database implementation to replace JsonDB
 * Uses Node.js built-in SQLite support (node:sqlite)
 */
export class SqliteDB {
    private db: DatabaseSync;
    static getType(data: any): string {
        if (data === null) return "null";
        if (Array.isArray(data)) return "array";
        return typeof data;
    }
    constructor(private filePath: string) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        // Ensure file has .db extension
        if (!this.filePath.endsWith(".db")) this.filePath = this.filePath + ".db";
        
        // Open or create database
        this.db = new DatabaseSync(this.filePath);
    }
    create(tableName: string, schema: SqliteDB.Schema): void {
        const indexColumns: string[] = [];
        const columns = Object.entries(schema)
            .map(([columnName, columnDef]) => {
                let colDef = `${columnName} ${columnDef.type}`;
                if (columnDef.index) indexColumns.push(columnName);
                if (columnDef.primaryKey) colDef += " PRIMARY KEY";
                if (columnDef.autoIncrement) colDef += " AUTOINCREMENT";
                if (columnDef.notNull) colDef += " NOT NULL";
                if (columnDef.unique) colDef += " UNIQUE";
                if (columnDef.default !== undefined)
                    colDef += ` DEFAULT (${columnDef.default()})`;
                return colDef;
            })
            .join(", ");
        
        const createTableSQL = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns})`;
        this.db.exec(createTableSQL);
        if(indexColumns.length>0){
            for(const col of indexColumns){
                const indexName=`idx_${tableName}_${col}`;
                const createIndexSQL=`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${col})`;
                this.db.exec(createIndexSQL);
            }
        }
    }
    select(...fieds:string[]){
        return new Selection(this.db,fieds);
    }
    insert(table:string){
        return new Insertion(this.db,table);
    }
    update(table:string){
        return new Updation(this.db,table);
    }
    delete(table:string){
        return new Deletion(this.db,table);
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}
export namespace SqliteDB {
    export type ColumnType="TEXT" | "INTEGER" | "REAL" | "BLOB";
    export type Column = {
        type: ColumnType;
        primaryKey?: boolean;
        autoIncrement?: boolean;
        index?: boolean;
        notNull?: boolean;
        unique?: boolean;
        default?:()=> string | number | boolean;
    }
    export type Schema={
        [columnName: string]: Column;
    }
    export function Column(type: ColumnType,options?:Omit<Column,"type">):Column
    export function Column(column:Column):Column
    export function Column(input:ColumnType|Column,options?:Omit<Column,"type">):Column{
        if(typeof input==="string"){
            return {
                type:input,
                ...options
            }
        }else{
            return input;
        }
    }
    export function formatValue(value:any){
        return JSON.stringify(value).replace(/"/g,"'");
    }
    export type QueryCondition<T extends {}={}>= T & {
        $and?: QueryCondition<T>;
        $or?: QueryCondition<T>;
        $like?: string;
        $not?: QueryCondition<T>;
        $regexp?: string;
        $gt?: number;
        $gte?: number;
        $lt?: number;
        $lte?: number;
        $between?: [number, number];
    };
    export function generateWhereClause(conditions: QueryCondition[],logic="AND"):string{
        const clauses:string[] = [];
        for(const condition of conditions){
            const subClauses:string[] = [];
            for(const key in condition){
                const value=condition[key];
                if(key==="$and" && typeof value==="object"){
                    subClauses.push(`(${generateWhereClause([value],"AND")})`);
                }else if(key==="$or" && typeof value==="object"){
                    subClauses.push(`(${generateWhereClause([value],"OR")})`);
                }else if(key==="$not" && typeof value==="object"){
                    subClauses.push(`NOT (${generateWhereClause([value],"AND")})`);
                }else if(key==="$like" && typeof value==="string"){
                    subClauses.push(`LIKE ${formatValue(value)}`);
                }else if(key==="$regexp" && typeof value==="string"){
                    subClauses.push(`REGEXP ${formatValue(value)}`);
                }else if(key==="$gt" && typeof value==="number"){
                    subClauses.push(`> ${value}`);
                }else if(key==="$gte" && typeof value==="number"){
                    subClauses.push(`>= ${value}`);
                }else if(key==="$lt" && typeof value==="number"){
                    subClauses.push(`< ${value}`);
                }else if(key==="$lte" && typeof value==="number"){
                    subClauses.push(`<= ${value}`);
                }else if(key==="$between" && Array.isArray(value) && value.length===2){
                    subClauses.push(`BETWEEN ${value[0]} AND ${value[1]}`);
                }else if(typeof value==='object' && value === null){
                    subClauses.push(`${key} IS NULL`);
                }else{
                    subClauses.push(`${key} = ${formatValue(value)}`);
                }
            }
            if(subClauses.length>0){
                clauses.push(`(${subClauses.join(" AND ")})`);
            }
        }
        return clauses.join(` ${logic} `);
    }
                    
}
export class Selection{
    private tableName:string;
    private whereClauses: SqliteDB.QueryCondition[] = [];
    private groupByClauses: string[] = [];
    private orderByClauses: string[] = [];
    constructor(private db:DatabaseSync,private fields:string[]){
    }
    from(tableName:string){
        this.tableName=tableName;
        return this;
    }
    where<T extends {}=Record<string, any>>(condition:SqliteDB.QueryCondition<T>){
        this.whereClauses.push(condition);
        return this;
    }
    groupBy(field:string){
        this.groupByClauses.push(field);
        return this;
    }
    orderBy(field:string,order:"ASC"|"DESC"="ASC"){
        this.orderByClauses.push(`${field} ${order}`);
        return this;
    }
    get sql(){
        return `SELECT ${this.fields.join(", ")} FROM ${this.tableName}
        ${this.whereClauses.length>0?`WHERE ${SqliteDB.generateWhereClause(this.whereClauses)}`:""}
        ${this.groupByClauses.length>0?`GROUP BY ${this.groupByClauses.join(", ")}`:""}
        ${this.orderByClauses.length>0?`ORDER BY ${this.orderByClauses.join(", ")}`:""}
        `;
    }
    run(){
        const stmt= this.db.prepare(this.sql);
        return stmt.all();
    }
}
export class Insertion{
    private columns: string[] = [];
    #values: (any[])[] = [];
    constructor(private db:DatabaseSync,private tableName:string){
    }
    values<T extends object>(first:T,...rest:T[]){
        const columns=Object.keys(first);
        this.columns=columns;
        this.#values.push(columns.map(col=>first[col]));
        for(const item of rest){
            this.#values.push(columns.map(col=>item[col]||null));
        }
        return this;
    }
    get sql(){
        const placeholders=this.#values.map((item)=>item.map(v=>SqliteDB.formatValue(v)).join(", ")).join("), (");
        return `INSERT INTO ${this.tableName} (${this.columns.join(", ")}) VALUES (${placeholders})`;
    }
    run(){
        const stmt= this.db.prepare(this.sql);
        return stmt.run();
    }
}
export class Updation{
    private setClauses: string[] = [];
    private whereClauses: SqliteDB.QueryCondition[] = [];
    constructor(private db:DatabaseSync,private tableName:string){
    }
    set<T extends object>(value:T){
        for(const key in value){
            this.setClauses.push(`${key} = ${SqliteDB.formatValue(value[key])}`);
        }
        return this;
    }
    where<T extends {}=Record<string, any>>(condition:SqliteDB.QueryCondition<T>){
        this.whereClauses.push(condition);
        return this;
    }
    get sql(){
        return `UPDATE ${this.tableName} SET ${this.setClauses.join(", ")}
        ${this.whereClauses.length>0?`WHERE ${SqliteDB.generateWhereClause(this.whereClauses)}`:""}
        `;
    }
    run(){
        const stmt= this.db.prepare(this.sql);
        return stmt.run();
    }
}
export class Deletion{
    private whereClauses: SqliteDB.QueryCondition[] = [];
    constructor(private db:DatabaseSync,private tableName:string){
    }
    where<T extends {}=Record<string, any>>(condition:SqliteDB.QueryCondition<T>){
        this.whereClauses.push(condition);
        return this;
    }
    get sql(){
        return `DELETE FROM ${this.tableName}
        ${this.whereClauses.length>0?`WHERE ${SqliteDB.generateWhereClause(this.whereClauses)}`:""}
        `;
    }
    run(){
        const stmt= this.db.prepare(this.sql);
        return stmt.run();
    }   
}
