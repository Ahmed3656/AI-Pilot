import { apiClient } from '@/api/client';

export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export async function getApiHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>('/health');
  return data;
}
