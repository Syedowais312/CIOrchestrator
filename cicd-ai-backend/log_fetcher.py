import httpx
from config import GITHUB_API_BASE, HEADERS_GITHUB

async def fetch_github_logs(repo: str, run_id: str) -> str:
    async with httpx.AsyncClient() as client:

        # Step 1 - get list of jobs in this run
        jobs_url = f"{GITHUB_API_BASE}/repos/{repo}/actions/runs/{run_id}/jobs"
        jobs_res = await client.get(jobs_url, headers=HEADERS_GITHUB)
        jobs = jobs_res.json().get("jobs", [])

        if not jobs:
            return "No jobs found for this run."

        # Step 2 - get logs of the first failed job
        failed_job = next((j for j in jobs if j["conclusion"] == "failure"), jobs[0])
        job_id = failed_job["id"]

        logs_url = f"{GITHUB_API_BASE}/repos/{repo}/actions/jobs/{job_id}/logs"
        logs_res = await client.get(
            logs_url,
            headers=HEADERS_GITHUB,
            follow_redirects=True
        )

        if logs_res.status_code == 200:
            # trim to last 6000 chars to stay within token limits
            return logs_res.text[-6000:]
        else:
            return f"Could not fetch logs. Status: {logs_res.status_code}"


async def fetch_repo_file(repo: str, path: str, ref: str = "main") -> str:
    async with httpx.AsyncClient() as client:
        url = f"{GITHUB_API_BASE}/repos/{repo}/contents/{path}?ref={ref}"
        res = await client.get(url, headers=HEADERS_GITHUB)

        if res.status_code == 200:
            import base64
            content = res.json().get("content", "")
            return base64.b64decode(content).decode("utf-8", errors="ignore")