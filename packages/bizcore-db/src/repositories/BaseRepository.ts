import { z } from 'zod';

export interface FindOptions {
  skip?: number;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
  include?: Record<string, any>;
}

export interface CreateInput<T> {
  [key: string]: any;
}

export interface UpdateInput<T> {
  [key: string]: any;
}

export abstract class BaseRepository<T> {
  abstract findById(id: string): Promise<T | null>;
  abstract findAll(options?: FindOptions): Promise<T[]>;
  abstract findOne(where: Partial<T>, options?: FindOptions): Promise<T | null>;
  abstract create(data: CreateInput<T>): Promise<T>;
  abstract update(id: string, data: UpdateInput<T>): Promise<T>;
  abstract delete(id: string): Promise<boolean>;
  abstract count(where?: Partial<T>): Promise<number>;
}
