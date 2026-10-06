import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuth';

const Justifications = () => {
  const [justifications, setJustifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const token = useAuthStore((s) => s.token);
  const loadJustifications = async () => {
    setLoading(true);
    try {
      const endpoint = filter === 'pending' 
        ? '/pending' 
        : `?approved=${filter === 'approved'}`;
      
      const res = await fetch(`${API}/api/justifications${endpoint}?page=${page}&limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setJustifications(data.justifications || []);
    } catch {
      setError('Failed to load justifications');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadJustifications();
  }, [filter, page]);
  const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';



  const handleApprove = async (id, approved, reason) => {
    try {
      const res = await fetch(`${API}/api/justifications/${id}/approve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ approved, reason }),
      });
      if (res.ok) {
        loadJustifications();
      }
    } catch {
      alert('Failed to process justification');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Justifications</h1>

        <div className="mb-6 flex gap-3">
          {['pending', 'approved', 'rejected'].map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-4 py-2 rounded-lg font-medium ${
                filter === f
                  ? 'bg-yellow-400 text-black'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">Loading...</div>
        ) : error ? (
          <div className="bg-red-50 p-4 rounded-lg text-red-700">{error}</div>
        ) : justifications.length === 0 ? (
          <div className="bg-white p-8 rounded-lg border border-gray-200 text-center text-gray-500">
            No justifications found
          </div>
        ) : (
          <div className="space-y-4">
            {justifications.map((j) => (
              <div
                key={j._id}
                className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p className="font-medium text-gray-900">
                      {j.userId?.name} ({j.userId?.email})
                    </p>
                    <p className="text-sm text-gray-600">
                      Domain: {j.eventId?.domain}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      j.approved === null
                        ? 'bg-yellow-50 text-yellow-700'
                        : j.approved
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {j.approved === null
                      ? 'Pending'
                      : j.approved
                      ? 'Approved'
                      : 'Rejected'}
                  </span>
                </div>

                <div className="bg-gray-50 p-4 rounded mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>User's Reason:</strong>
                  </p>
                  <p className="text-gray-800">{j.reason}</p>
                </div>

                {j.approved !== null && (
                  <div className="bg-blue-50 p-3 rounded text-sm">
                    <strong>Decision:</strong> {j.approvalReason}
                  </div>
                )}

                {j.approved === null && (
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => handleApprove(j._id, true, 'Approved')}
                      className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApprove(j._id, false, 'Rejected - policy violation')}
                      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Justifications;
