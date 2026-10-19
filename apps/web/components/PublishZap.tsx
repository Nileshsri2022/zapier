'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from './Button';
import ZapCell from './ZapCell';
import { TSelectedAction, TSelectedTrigger } from '@repo/types';
import axios from 'axios';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import Spinner from './Spinner';
import Modal from './Modal';
import StepConditionsEditor from './StepConditionsEditor';
import FilterBuilder, { FilterCondition } from './FilterBuilder';
import { API_URL } from '@/lib/config';
import { getPendingSelection } from '@/lib/oauth';

const emptyAction = {
  availableActionId: '',
  actionType: '',
  actionMetaData: {},
};

const parseSafeZapId = (rawId?: string | null): string => {
  if (!rawId) return '';
  const trimmed = rawId.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

const PublishZap = ({ zapId }: { zapId?: string }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedTrigger, setSelectedTrigger] = useState<TSelectedTrigger>();
  const [selectedActions, setSelectedActions] = useState<TSelectedAction[]>([emptyAction]);
  const [modalVisibilityFor, setModalVisibilityFor] = useState<number>(0);
  const [sheetsConnected, setSheetsConnected] = useState<boolean>(false);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [zapIdString, setZapIdString] = useState<string>('');

  // Save state to sessionStorage before OAuth redirect (call this before redirecting)
  const saveStateForOAuth = () => {
    const stateToSave = {
      selectedTrigger,
      selectedActions,
      filterConditions,
      zapIdString,
    };
    sessionStorage.setItem('zapmate_editor_state', JSON.stringify(stateToSave));
  };

  // Expose saveStateForOAuth globally so OAuth components can call it
  useEffect(() => {
    (window as any).saveZapStateForOAuth = saveStateForOAuth;
    return () => {
      delete (window as any).saveZapStateForOAuth;
    };
  }, [selectedTrigger, selectedActions, filterConditions, zapIdString]);

  // Restore state from sessionStorage after OAuth redirect
  useEffect(() => {
    const sheetsStatus = searchParams.get('sheets');
    const gmailStatus = searchParams.get('gmail');
    const calendarStatus = searchParams.get('calendar');

    // Check if we came back from OAuth
    if (sheetsStatus || gmailStatus || calendarStatus) {
      // Restore state from sessionStorage
      const savedState = sessionStorage.getItem('zapmate_editor_state');
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          if (parsed.selectedTrigger) setSelectedTrigger(parsed.selectedTrigger);
          if (parsed.selectedActions) setSelectedActions(parsed.selectedActions);
          if (parsed.filterConditions) setFilterConditions(parsed.filterConditions);
          if (parsed.zapIdString) setZapIdString(parsed.zapIdString);
          sessionStorage.removeItem('zapmate_editor_state'); // Clean up
        } catch (e) {
          console.error('Failed to restore Zap state:', e);
        }
      }

      // Restore pending selection from Modal (action/trigger that was being configured)
      const pendingSelection = getPendingSelection();
      if (pendingSelection?.selectedItem) {
        const { selectedItem, modalFor } = pendingSelection;

        if (modalFor === 1) {
          // It was a trigger selection
          setSelectedTrigger({
            availableTriggerId: selectedItem.id,
            triggerType: selectedItem.type,
            triggerMetaData: selectedItem.metadata || {},
          });
        } else if (modalFor > 1) {
          // It was an action selection (modalFor - 2 = action index)
          const actionIndex = modalFor - 2;
          setSelectedActions((prev) => {
            const updated = [...prev];
            // Ensure we have enough action slots
            while (updated.length <= actionIndex) {
              updated.push({ availableActionId: '', actionType: '', actionMetaData: {} });
            }
            updated[actionIndex] = {
              availableActionId: selectedItem.id,
              actionType: selectedItem.type,
              actionMetaData: selectedItem.metadata || {},
            };
            return updated;
          });
        }
      }

      // Show success/error toasts
      if (sheetsStatus === 'connected') {
        setSheetsConnected(true);
        toast.success('✅ Google Sheets connected!');
      } else if (sheetsStatus === 'error') {
        toast.error('❌ Failed to connect Google Sheets.');
      }
      if (gmailStatus === 'connected') {
        toast.success('✅ Gmail connected!');
      } else if (gmailStatus === 'error') {
        toast.error('❌ Failed to connect Gmail.');
      }
      if (calendarStatus === 'connected') {
        toast.success('✅ Google Calendar connected!');
      } else if (calendarStatus === 'error') {
        toast.error('❌ Failed to connect Google Calendar.');
      }

      // Clean up URL
      setTimeout(() => router.replace('/editor'), 100);
    }
  }, [searchParams, router]);

  useEffect(() => {
    const targetZapId = parseSafeZapId(zapId);
    if (targetZapId) {
      const fetchZapDetails = async () => {
        try {
          setZapIdString(targetZapId);
          const {
            data: { zap },
          } = await axios.get(`${API_URL}/api/zaps/${targetZapId}`, {
            withCredentials: true, // Use httpOnly cookie for auth
          });
          setSelectedTrigger({
            availableTriggerId: zap.trigger?.trigger?.id,
            triggerType: zap.trigger?.trigger?.type,
            triggerMetaData: zap.trigger?.metadata || {},
          });
          setSelectedActions(
            zap.actions?.map((a: any) => ({
              availableActionId: a.action?.id,
              actionType: a.action?.type,
              actionMetaData: a.metadata || {},
              stepConditions: a.stepConditions || [],
            })) || [emptyAction]
          );
          // Load filter conditions
          if (zap.filterConditions) {
            setFilterConditions(zap.filterConditions);
          }
        } catch (error) {
          console.error('Fetch zap error:', error);
          toast.error('Could not fetch zap details!');
          router.push('/dashboard');
        }
      };

      fetchZapDetails();
    }
  }, [zapId, router]);

  const handlePublish = async () => {
    if (!selectedTrigger?.availableTriggerId) {
      toast.error('Please configure a trigger event before publishing.');
      return;
    }
    const hasIncompleteAction = selectedActions.some((action) => !action.availableActionId);
    if (hasIncompleteAction) {
      toast.error('Please select an event for each action step before publishing.');
      return;
    }

    setLoading(true);
    const createZapData = {
      availableTriggerId: selectedTrigger.availableTriggerId,
      triggerMetaData: selectedTrigger.triggerMetaData || {},
      actions: selectedActions.map((action) => ({
        availableActionId: action.availableActionId,
        actionMetaData: action.actionMetaData,
        stepConditions: action.stepConditions || [],
      })),
    };

    try {
      const targetZapId = zapIdString || parseSafeZapId(zapId);
      if (!targetZapId) {
        await axios.post(`${API_URL}/api/zaps`, createZapData, {
          withCredentials: true, // Use httpOnly cookie for auth
        });
        toast.success('Zap published successfully!');
      } else {
        await axios.put(`${API_URL}/api/zaps/${targetZapId}`, createZapData, {
          withCredentials: true, // Use httpOnly cookie for auth
        });
        toast.success('Zap saved successfully!');
      }
      router.push('/dashboard');
    } catch (error: any) {
      console.error('Publish error:', error);
      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        'Failed to save zap. Please verify your configuration.';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerOrActionSelection = (selectedItem: any) => {
    if (modalVisibilityFor === 1) {
      setSelectedTrigger &&
        setSelectedTrigger({
          availableTriggerId: selectedItem?.id,
          triggerType: selectedItem?.type,
          triggerMetaData: selectedItem?.metadata || {},
        });
    } else if (modalVisibilityFor > 1) {
      setSelectedActions &&
        setSelectedActions((a) =>
          a.map((action, i) =>
            i + 2 === modalVisibilityFor
              ? {
                  ...action,
                  actionType: selectedItem?.type,
                  availableActionId: selectedItem?.id,
                  actionMetaData: selectedItem?.metadata,
                }
              : action
          )
        );
    }

    setModalVisibilityFor(0);
  };

  const handleCellClick = (index: number) => {
    if (index === 1) {
      setModalVisibilityFor(1);
    } else if (Number(index) > 1) {
      setModalVisibilityFor(Number(index));
    } else {
      setModalVisibilityFor(0);
    }
  };

  const handleActionDelete = (index: number) => {
    setSelectedActions(selectedActions.filter((_, i) => i + 2 !== index));
  };

  return (
    <>
      {/* Editor Sub-Header Toolbar */}
      <div className="editor-toolbar">
        <Link href="/dashboard" className="editor-back-link">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            width="16"
            height="16"
          >
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
              clipRule="evenodd"
            />
          </svg>
          Back to Zaps
        </Link>
        <Button variant="primary" onClick={handlePublish} disabled={loading}>
          {loading ? (
            <Spinner color="white" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              width="20"
              height="20"
              style={{ marginRight: '0.375rem' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
              />
            </svg>
          )}
          <span>{zapIdString || parseSafeZapId(zapId) ? 'Save Zap' : 'Publish Zap'}</span>
        </Button>
      </div>

      {/* Editor Canvas Steps */}
      <div className="editor-canvas">
        <div className="editor-step-wrap">
          <ZapCell
            index={1}
            name={selectedTrigger ? selectedTrigger.triggerType : 'Trigger'}
            onClick={() => handleCellClick(1)}
          />
          {sheetsConnected && <div className="editor-connected-badge">✓ Connected</div>}
        </div>

        {/* Filter Builder - shown when editing existing Zap */}
        {zapIdString && (
          <div className="editor-filter-wrap">
            <FilterBuilder
              zapId={zapIdString}
              initialConditions={filterConditions}
              onSave={setFilterConditions}
            />
          </div>
        )}
        {selectedActions?.map((action, index) => (
          <div key={index} className="editor-step-wrap">
            <ZapCell
              index={index + 2}
              name={action.actionType ? action.actionType : 'Action'}
              onClick={() => handleCellClick(index + 2)}
              handleDelete={handleActionDelete}
            />
            {action.availableActionId && (
              <StepConditionsEditor
                step={index + 1}
                conditions={action.stepConditions || []}
                onChange={(conditions) =>
                  setSelectedActions((current) =>
                    current.map((entry, i) =>
                      i === index ? { ...entry, stepConditions: conditions } : entry
                    )
                  )
                }
              />
            )}
          </div>
        ))}
      </div>

      {/* Add Step Button */}
      <div className="editor-add-step-row">
        <button
          type="button"
          onClick={() => setSelectedActions((a) => [...a, emptyAction])}
          className="editor-add-btn"
          aria-label="Add action step"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="editor-add-btn__icon"
          >
            <path
              fillRule="evenodd"
              d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      {modalVisibilityFor !== 0 && (
        <Modal
          isVisible={modalVisibilityFor}
          setIsVisible={setModalVisibilityFor}
          onClick={handleTriggerOrActionSelection}
          initialAiAction={
            selectedActions[modalVisibilityFor - 2]?.actionType === 'AI Transform'
              ? selectedActions[modalVisibilityFor - 2]
              : undefined
          }
        />
      )}
    </>
  );
};

export default PublishZap;
