'use client';
import { useState } from 'react';
import FormInput from '../FormInput';
import Button from '../Button';

interface GmailMetaDataProps {
  handleClick: (data: any) => void;
  selectedType: string;
}

const GmailMetaData = ({ handleClick, selectedType }: GmailMetaDataProps) => {
  const [formData, setFormData] = useState({
    to: '',
    subject: '',
    body: '',
    labelName: '',
    replyMessage: '',
    senderFilter: '',
    subjectFilter: '',
    watchedLabels: '',
  });

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
      case 'Gmail Starred':
        return (
          <div className="meta-form">
            <p className="meta-form__text">
              No additional configuration needed for starred emails trigger.
            </p>
            <Button variant="secondary" onClick={() => handleClick({})}>
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
