export interface FindOptions {
  skip?: number;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface CreateInput<T> {
  [key: string]: any;
}

export interface UpdateInput<T> {
  [key: string]: any;
}
