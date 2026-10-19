'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { toast } from 'react-toastify';
import { API_URL } from '@/lib/config';
import { Spinner } from '@/components/ui/spinner';

interface UserData {
  id: number;
  name: string;
  email: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      // Check if user data exists in localStorage (indicates possible login)
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        router.push('/login');
        return;
      }

      try {
        const response = await axios.get(`${API_URL}/api/auth/me`, {
          withCredentials: true, // Use httpOnly cookie for auth
        });
        setUser(response.data.user);
      } catch (error: any) {
        // If unauthorized, redirect to login
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          localStorage.removeItem('user');
          router.push('/login');
          return;
        }
        toast.error('Failed to load profile');
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [router]);

  if (loading) {
    return (
      <div className="profile-center">
        <Spinner color="primary" />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-shell">
        <h1 className="profile-title">My Profile</h1>

        <section className="profile-card">
          <div className="profile-card__head">
            <div className="profile-avatar" aria-hidden="true">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div>
              <h2 className="profile-name">{user?.name || 'User'}</h2>
              <p className="profile-email">{user?.email || 'No email'}</p>
            </div>
          </div>

          <div className="profile-section">
            <h3 className="profile-section__title">Account Details</h3>

            <dl className="profile-rows">
              <div className="profile-row">
                <dt>Name</dt>
                <dd>{user?.name}</dd>
              </div>
              <div className="profile-row">
                <dt>Email</dt>
                <dd>{user?.email}</dd>
              </div>
              <div className="profile-row">
                <dt>User ID</dt>
                <dd>#{user?.id}</dd>
              </div>
            </dl>
          </div>

          <div className="profile-actions">
            <button
              type="button"
              className="profile-back"
              onClick={() => router.push('/dashboard')}
            >
              Back to Dashboard
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
