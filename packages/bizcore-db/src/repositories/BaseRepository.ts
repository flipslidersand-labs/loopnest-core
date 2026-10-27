export interface FindOptions {
  skip?: number;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

/**
 * Input for create(): any subset of the entity's fields (repositories apply
 * defaults) plus the fields K that the repository requires.
 */
export type CreateInput<T, K extends keyof T = never> = Partial<T> & Required<Pick<T, K>>;

/** Input for update(): any subset of the entity's fields. */
export type UpdateInput<T> = Partial<T>;
