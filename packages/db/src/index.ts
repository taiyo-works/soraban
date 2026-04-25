export type DatabaseClient = {
  readonly url: string;
};

export const createDatabaseClient = (url: string, _anonKey: string): DatabaseClient => ({
  url,
});
