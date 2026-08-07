import { apiRequest, getApiBaseUrl } from './client';
import { getToken } from '../auth-storage';

export type ReportFormat = 'pdf' | 'csv';

export type Report = {
  id: string;
  period_start: string;
  period_end: string;
  format: ReportFormat;
  generated_at: string;
};

export type ReportsPage = {
  data: Report[];
  meta: { page: number; limit: number; total: number };
};

export function createReport(body: {
  period_start: string;
  period_end: string;
  format: ReportFormat;
}): Promise<Report> {
  return apiRequest<Report>('/reports', { method: 'POST', body });
}

export function listReports(params?: {
  page?: number;
  limit?: number;
}): Promise<ReportsPage> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiRequest<ReportsPage>(`/reports${suffix}`);
}

export function getReport(id: string): Promise<Report> {
  return apiRequest<Report>(`/reports/${id}`);
}

export async function downloadReport(id: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${getApiBaseUrl()}/reports/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telos-report-${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
