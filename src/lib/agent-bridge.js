const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-agent-token': process.env.CONTROL_PLANE_TOKEN
});

const getBaseUrl = () => process.env.AXIOMA_API_URL;

export async function getPendingBlogs(platform) {
  const res = await fetch(`${getBaseUrl()}/agent-bridge/blogs/pending?platform=${platform}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`getPendingBlogs failed for ${platform}`);
  return await res.json();
}

export async function markPublished(blogId, platform, linkedinPostId) {
  const body = { platform };
  if (linkedinPostId) body.linkedin_post_id = linkedinPostId;

  const res = await fetch(`${getBaseUrl()}/agent-bridge/blogs/${blogId}/mark-published`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`markPublished failed for ${blogId}`);
  return await res.json();
}

export async function logActivity(data) {
  const res = await fetch(`${getBaseUrl()}/agent-bridge/activity-log`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      agent: data.agent || 'Axio Scout',
      skill: data.skill || 'unknown',
      action: data.action || 'Action',
      ref_id: data.ref_id,
      ref_type: data.ref_type,
      status: data.status || 'success',
      detail: data.detail
    })
  });
  if (!res.ok) throw new Error(`logActivity failed: ${await res.text()}`);
  return await res.json();
}

export async function createLead(data) {
  const res = await fetch(`${getBaseUrl()}/agent-bridge/leads`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`createLead failed`);
  return await res.json();
}

export async function syncBlogs() {
  const res = await fetch(`${getBaseUrl()}/agent-bridge/blogs/sync`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`syncBlogs failed: ${res.status}`);
  return await res.json();
}
