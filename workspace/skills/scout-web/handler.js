async function handle(input) {
  const { mode, platform, id, detail, agent, skill, action, status, ref_id, ref_type } = input;
  const baseUrl = process.env.AXIOMA_API_URL;
  const token = process.env.CONTROL_PLANE_TOKEN;
  
  const headers = {
    'Content-Type': 'application/json',
    'x-agent-token': token
  };

  if (mode === 'db_audit') {
    const fetchPlatform = async (plat) => {
      try {
        const res = await fetch(`${baseUrl}/agent-bridge/blogs/pending?platform=${plat}`, { headers });
        if (!res.ok) return [];
        return await res.json();
      } catch (err) {
        console.error(`Error fetching pending blogs for ${plat}:`, err.message);
        return [];
      }
    };

    return {
      linkedin: await fetchPlatform('linkedin'),
      instagram: await fetchPlatform('instagram'),
      facebook: await fetchPlatform('facebook')
    };
  }

  if (mode === 'mark_published') {
    try {
      const res = await fetch(`${baseUrl}/agent-bridge/blogs/${id}/mark-published`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ platform })
      });
      return { status: res.ok ? 'success' : 'failed' };
    } catch (err) {
      console.error('Error marking published:', err.message);
      return { status: 'failed', error: err.message };
    }
  }

  if (mode === 'log_activity') {
    try {
      const res = await fetch(`${baseUrl}/agent-bridge/activity-log`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent: agent || 'Axio Scout',
          skill: skill || 'unknown',
          action: action || 'Action',
          ref_id,
          ref_type,
          status: status || 'success',
          detail
        })
      });
      return { status: res.ok ? 'success' : 'failed' };
    } catch (err) {
      console.error('Error logging activity:', err.message);
      return { status: 'failed', error: err.message };
    }
  }

  return { status: "failed", error: "Invalid mode" };
}

module.exports = { handle };
