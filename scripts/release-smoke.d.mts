export function releaseSmoke(
  origin: string,
  request?: (url: URL, options: RequestInit) => Promise<Response>
): Promise<{
  origin: string;
  checkedAt: string;
  checks: { path: string; status: number; result: "passed" }[];
  limitation: string;
}>;
