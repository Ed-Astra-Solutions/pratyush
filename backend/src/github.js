/** Thin GitHub REST client — only the four calls this service needs. */

const API = 'https://api.github.com';

export class GitHub {
  constructor({ token, owner, repo, branch = 'main', workflow = 'deploy.yml', committer }) {
    Object.assign(this, { token, owner, repo, branch, workflow, committer });
  }

  async call(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pl-admin-api',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `GitHub ${res.status}`);
      err.status = res.status;
      err.github = data;
      throw err;
    }
    return data;
  }

  get base() { return `/repos/${this.owner}/${this.repo}`; }

  /** File contents + blob sha (the sha is the concurrency token for writes). */
  async getFile(path) {
    const r = await this.call(`${this.base}/contents/${encodeURI(path)}?ref=${this.branch}`);
    return { text: Buffer.from(r.content, 'base64').toString('utf8'), sha: r.sha };
  }

  /**
   * Create or update a file. Passing the sha we read makes the write fail
   * with 409 if someone else committed in between, instead of clobbering.
   */
  async putFile({ path, contentBase64, message, sha }) {
    const r = await this.call(`${this.base}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: contentBase64,
        branch: this.branch,
        ...(sha ? { sha } : {}),
        ...(this.committer ? { committer: this.committer, author: this.committer } : {}),
      }),
    });
    return { sha: r.content.sha, commit: r.commit.sha, url: r.commit.html_url };
  }

  /** Manual rebuild without a content change. */
  dispatchWorkflow() {
    return this.call(`${this.base}/actions/workflows/${this.workflow}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: this.branch }),
    });
  }

  async recentRuns(limit = 8) {
    const r = await this.call(`${this.base}/actions/runs?per_page=${limit}&branch=${this.branch}`);
    return (r.workflow_runs || []).map((run) => ({
      id: run.id,
      name: run.name,
      title: run.display_title,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      url: run.html_url,
    }));
  }
}
