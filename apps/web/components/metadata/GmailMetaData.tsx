'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '@/lib/config';
import FormInput from '../FormInput';
import Button from '../Button';

interface GmailMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
  preSelectedServerId?: string;
}

const GmailMetaData = ({ handleClick, selectedType, preSelectedServerId }: GmailMetaDataProps) => {
  const [formData, setFormData] = useState({
    to: '',
    subject: '',
    body: '',
    labelName: '',
    replyMessage: '',
    senderFilter: '',
    subjectFilter: '',
    watchedLabels: '',
    searchQuery: '',
    serverId: preSelectedServerId || '',
  });

  // The editor's Modal collects the connected mailbox in step 2 but never
  // threaded it into step 3 metadata — without serverId, createZap cannot
  // materialize the GmailTrigger row (grilled spec: every Gmail trigger
  // needs the chosen connection). Preselect the modal's choice, or fall back
  // to the user's first connected Gmail server.
  useEffect(() => {
    if (preSelectedServerId) {
      setFormData((prev) => ({ ...prev, serverId: preSelectedServerId }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await axios.get(`${API_URL}/api/gmail/servers`, {
          withCredentials: true,
        });
        const servers = response?.data?.servers || response?.data?.gmailServers || [];
        if (!cancelled && servers.length > 0) {
          setFormData((prev) => ({ ...prev, serverId: prev.serverId || servers[0].id }));
        }
      } catch {
        // Servers may simply not exist yet — Save then carries an empty id
        // and the server rejects it with a clear "requires a connection".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preSelectedServerId]);

  const handleFormDataChange = (e: any) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const renderGmailForm = () => {
    switch (selectedType) {
      case 'Gmail Send Email':
        return (
          <div className="meta-form">
            <FormInput
              label="To"
              name="to"
              placeholder="recipient@example.com"
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Subject"
              name="subject"
              placeholder="Email subject"
              onChange={handleFormDataChange}
            />
            <textarea
              className="meta-form__textarea"
              placeholder="Email content..."
              rows={8}
              name="body"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Reply':
        return (
          <div className="meta-form">
            <textarea
              className="meta-form__textarea"
              placeholder="Reply message..."
              rows={8}
              name="replyMessage"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Add Label':
      case 'Gmail Remove Label':
        return (
          <div className="meta-form">
            <FormInput
              label={`${selectedType === 'Gmail Add Label' ? 'Add' : 'Remove'} Label`}
              name="labelName"
              placeholder="Label name"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Mark as Read':
      case 'Gmail Archive':
        return (
          <div className="meta-form">
            <p className="meta-form__text">No additional configuration needed for this action.</p>
            <Button variant="secondary" onClick={() => handleClick({})}>
              Save
            </Button>
          </div>
        );
      case 'Gmail New Email':
        return (
          <div className="meta-form">
            <FormInput
              label="Sender Filter (optional)"
              name="senderFilter"
              placeholder="sender@example.com"
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Subject Filter (optional)"
              name="subjectFilter"
              placeholder="Contains keyword"
              onChange={handleFormDataChange}
            />
            <FormInput
              label="Watch Labels (optional)"
              name="watchedLabels"
              placeholder="INBOX,SENT,IMPORTANT"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Labeled':
        return (
          <div className="meta-form">
            <FormInput
              label="Watch Labels"
              name="watchedLabels"
              placeholder="INBOX,SENT,IMPORTANT"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      case 'Gmail Matching Search':
        return (
          <div className="meta-form">
            <FormInput
              label="Search Query"
              name="searchQuery"
              placeholder='from:ada@example.com subject:invoice has:attachment'
              onChange={handleFormDataChange}
            />
            <p className="meta-form__text">
              Gmail search syntax (from:, to:, subject:, label:, has:attachment, is:unread, and
              plain words). Fires once for each new matching email.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                formData.searchQuery.trim()
                  ? handleClick(formData)
                  : alert('Search query is required')
              }
            >
              Save
            </Button>
          </div>
        );
      case 'Gmail Starred':
        return (
          <div className="meta-form">
            <p className="meta-form__text">
              No additional configuration needed for starred emails trigger.
            </p>
            <Button variant="secondary" onClick={() => handleClick({ serverId: formData.serverId })}>
              Save
            </Button>
          </div>
        );
      case 'Gmail From Sender':
        return (
          <div className="meta-form">
            <FormInput
              label="Sender Email"
              name="senderFilter"
              placeholder="sender@example.com"
              onChange={handleFormDataChange}
            />
            <Button variant="secondary" onClick={() => handleClick(formData)}>
              Save
            </Button>
          </div>
        );
      default:
        return (
          <div className="meta-form">
            <p className="meta-form__text">Unknown Gmail action type.</p>
            <Button variant="secondary" onClick={() => handleClick({})}>
              Save
            </Button>
          </div>
        );
    }
  };

  return renderGmailForm();
};

export default GmailMetaData;
