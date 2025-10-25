import type { VersionedArvoContract } from 'arvo-core';

export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Generic type alias for any versioned Arvo contract.
 * Used as a constraint for service contract type parameters.
 */
// biome-ignore lint/suspicious/noExplicitAny: Needs to be general
export type AnyVersionedContract = VersionedArvoContract<any, any>;
