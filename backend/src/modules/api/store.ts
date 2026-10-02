/**
 * Accumulation store — holds each user's config + per-brand balances/holdings.
 *
 * This is an IN-MEMORY implementation for development: state is lost on restart.
 * It sits behind the AccumulationStore interface so a Postgres-backed store can
 * replace it later without touching the API/service code.
 */
import { newLoopState, type LoopState, type SimConfig, type SimEvent } from '../simulation/runSimulation.js';

export interface UserState {
  readonly userId: string;
  config: SimConfig;
  readonly state: LoopState;
  /** ref -> the event we returned, so retries of the same txn are idempotent. */
  readonly processed: Map<string, SimEvent>;
}

export interface AccumulationStore {
  createUser(userId: string, config: SimConfig): UserState;
  getUser(userId: string): UserState | undefined;
}

export class InMemoryStore implements AccumulationStore {
  private readonly users = new Map<string, UserState>();

  createUser(userId: string, config: SimConfig): UserState {
    const user: UserState = { userId, config, state: newLoopState(), processed: new Map() };
    this.users.set(userId, user);
    return user;
  }

  getUser(userId: string): UserState | undefined {
    return this.users.get(userId);
  }
}
