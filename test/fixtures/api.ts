export interface ApiResponse<T> {
  data: T;
  status: number;
  timestamp: string;
}

export async function fetchData<T>(endpoint: string): Promise<ApiResponse<T>> {
  const res = await fetch(endpoint);
  const data: T = await res.json();
  return {
    data,
    status: res.status,
    timestamp: new Date().toISOString(),
  };
}
