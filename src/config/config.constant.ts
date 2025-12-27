export const config = {
  redis_host: process.env.REDIS_HOST,
  redis_port: process.env.REDIS_PORT ?? 6379,
  redis_url: process.env.REDIS_URL,
  fmp_api_key: process.env.FMP_API_KEY,
  finhub_api_key: process.env.FINHUB_FOREX
};