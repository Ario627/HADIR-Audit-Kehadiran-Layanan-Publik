import type { Transaction, TransactionContext } from './client';

export type TransactionRunner = <T>(
  work: (tx: Transaction) => Promise<T>,
  context?: TransactionContext,
) => Promise<T>;

export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');