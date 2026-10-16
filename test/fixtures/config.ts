export interface AppConfig {
  apiUrl: string;
  env: 'development' | 'production' | 'test';
  maxRetries: number;
}

export const config: AppConfig = {
  apiUrl: 'https://api.magnon.dev',
  env: 'production',
  maxRetries: 3,
};
