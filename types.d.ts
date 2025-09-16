declare module 'filemaker-connect' {
  interface IFieldData {
    [key: string]:  string | number
  }

  export interface IFileMakerResponseRow {
    fieldData: IFieldData
    portalData: Record<string, IFieldData[]>
    recordId: string
    modId: string
  }

  export interface IFieldMetaDatum {
    name: string;
    type: string;
    displayType: string;
    result: string;
    global: boolean;
    autoEnter: boolean;
    fourDigitYear: boolean;
    maxRepeat: number;
    maxCharacters: number;
    notEmpty: boolean;
    numeric: boolean;
    timeOfDay: boolean;
    repetitionStart: number;
    repetitionEnd: number;
  }

  export type IPortalMetaData = Record<string, IFieldMetaDatum[]>

  export default class FilemakerConnect {
    constructor(params: object);
    tokenPool: object[];
    on(event: string, callback:  (params: object) => void): void;
    getToken(): Promise<void>;
    create(params: { layout: string, fieldData: object, portalData?: object }): Promise<number>;
    update(params: { recordId: number, layout: string, fieldData: object, portalData?: object }): Promise<IFileMakerResponseRow>
    delete(params: { layout: string, recordId: number }): Promise<object>;
    findByRecordId(params: { recordId: number, layout: string }): Promise<IFileMakerResponseRow>;
    findAll(params: {
      layout?: string;
      limit?: number;
      offset?: number;
      rejectOnEmpty?: boolean;
      query?: object[];
      sort?: Array<[string, 'asc' | 'desc']>;
      timeout?: number;
    }): Promise<IFileMakerResponseRow[]>;
    runScript(params: { layout: string, script: string, param?: string | number, timeout?: number }): Promise<object>
    getLayouts(): Promise<Object[]>
    getLayout(name: string): Promise<{ fieldMetaData: IFieldMetaDatum[], portalMetaData: IPortalMetaData }>
  }
}

