export interface FindOptions {
  skip?: number;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface CreateInput<_T> {
  [key: string]: any;
}

export interface UpdateInput<_T> {
  [key: string]: any;
}
