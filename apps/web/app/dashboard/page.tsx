'use client';
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import MainSection from '@/components/MainSection';
import Button from '@/components/Button';
import { toast } from 'react-toastify';
import Spinner from '@/components/Spinner';
import { formatDateTimeToCustomString, getSessionDetails } from '../../helper';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Tooltip from '@/components/Tooltip';
import { API_URL, HOOKS_URL } from '@/lib/config';
import ZapRunHistory from '@/components/ZapRunHistory';

interface TZap {
  id: string;
  name?: string;
  triggerId: string;
  actions: TAction[];
  trigger: TTrigger;
  createdDate: Date | string;
  isActive: boolean;
}

interface TAction {
  id: string;
  actionId: string;
  zapId: string;
  sortingOrder: number;
  metadata: JSON | null;
  action: {
    type: string;
    image: string;
  };
}

interface TTrigger {
  id: string;
  metadata: JSON | null;
  triggerId: string;
  zapId: string;
  trigger: {
    type: string;
    image: string;
  };
}

export default function Page() {
  const router = useRouter();
  const session = getSessionDetails();
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedRow, setSelectedRow] = useState<number>(-1);
  const [renameEnabled, setRenameEnabled] = useState<number>(-1);
  const [data, setData] = useState<{ zaps: TZap[] | []; total: number }>({ zaps: [], total: 0 });
  const [historyZap, setHistoryZap] = useState<TZap | null>(null);

  const fetchData = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/zaps`, {
        withCredentials: true, // Use httpOnly cookie for auth
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      setData({ zaps: response?.data?.data?.zaps, total: response?.data?.data?.total });
    } catch {
      toast.error("Couldn't fetch the data");
    }
    setLoading(false);
  };

  const handleCreateClick = () => {
    router.push('/editor');
  };

  const handleUrlCopy = async (url: string) => {
    try {
      await window.navigator.clipboard.writeText(url);
      toast.info('Copied to clipboard!');
    } catch {
      toast.error('Unable to copy to clipboard');
    }
  };

  const handleRenameBlur = async (e: React.FocusEvent<HTMLInputElement>, zap: TZap) => {
    if (!session) return;
    setLoading(true);
    try {
      if (e.target.value !== zap.name) {
        await axios.patch(
          `${API_URL}/api/zaps/${zap.id}/rename`,
          { name: e.target.value },
          { withCredentials: true }
        );
        toast.success('Zap renamed successfully!');
        fetchData();
      }
    } catch {
      toast.error('Could not update the zap, please try again.');
    }
    setRenameEnabled(-1);
    setLoading(false);
  };

  const toggleZapExecution = async (e: React.ChangeEvent<HTMLInputElement>, zap: TZap) => {
    if (!session) return;
    try {
      await axios.patch(
        `${API_URL}/api/zaps/${zap.id}/enable`,
        { isActive: !!e.target.checked },
        { withCredentials: true }
      );
      fetchData();
    } catch {
      toast.error(`Could not ${zap.isActive ? 'disable' : 'enable'} Zap`);
    }
  };

  const handleZapDelete = async (zap: TZap) => {
    if (!session) return;
    try {
      await axios.delete(`${API_URL}/api/zaps/${zap.id}`, {
        withCredentials: true,
      });
      toast.success(`Zap deleted successfully`);
      fetchData();
    } catch {
      toast.error('Could not delete the zap!');
    }
  };

  useEffect(() => {
    const currentSession = getSessionDetails();
    if (!currentSession) {
      router.push('/');
      return;
    }
    fetchData();
  }, []);

  return (
    <MainSection>
      <div className="flex flex-col py-4 px-2 xs:px-3 sm:px-6 md:px-12 lg:px-20 gap-4 xs:gap-6">
        <div className="flex flex-col xs:flex-row justify-between items-start xs:items-center gap-2">
          <h3 className="text-xl xs:text-2xl sm:text-3xl font-semibold">My Zaps</h3>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleCreateClick}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#FFFFFF"
                className="size-6"
              >
                <path
                  fillRule="evenodd"
                  d="M12 3.75a.75.75 0 0 1 .75.75v6.75h6.75a.75.75 0 0 1 0 1.5h-6.75v6.75a.75.75 0 0 1-1.5 0v-6.75H4.5a.75.75 0 0 1 0-1.5h6.75V4.5a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="mx-2 my-1">Create</span>
            </Button>
          </div>
        </div>

        {/* Desktop Table - Hidden on mobile */}
        <table className="hidden md:table">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="font-normal py-3 text-start w-40">Name</th>
              <th className="font-normal py-3 text-start w-40">Flow</th>
              <th className="font-normal py-3 text-start">Webhook URL</th>
              <th className="font-normal py-3 text-start">Created At</th>
              <th className="font-normal py-3 text-center w-20">Status</th>
              <th className="font-normal py-3 text-start"></th>
            </tr>
          </thead>
          <tbody>
            {data.total > 0 &&
              data?.zaps?.map((zap: TZap, index) => {
                // @ts-ignore
                const url = `${HOOKS_URL}/hooks/${session?.user?.id}/${zap.id}`;
                const parsedData = JSON.stringify(zap.id);

                return (
                  <tr key={zap.id} className="border-b border-gray-200">
                    <td className="font-normal mr-1 py-3 text-start">
                      {loading ? (
                        <Spinner color="primary" />
                      ) : index === renameEnabled ? (
                        <input
                          defaultValue={zap.name}
                          autoFocus={renameEnabled === index}
                          onBlur={(e) => handleRenameBlur(e, zap)}
                          type="text"
                          className="rounded-md w-full max-w-32 px-2 py-1 bg-white"
                        />
                      ) : (
                        <Link
                          className="hover:underline underline-offset-2 text-secondary-700"
                          href={{ pathname: '/editor', query: { zapId: parsedData } }}
                        >
                          {zap.name}
                        </Link>
                      )}
                    </td>
                    <td className="font-normal py-3 text-start flex">
                      <Tooltip tooltipText={zap.trigger.trigger.type}>
                        <img
                          className="w-6 border p-[3px] border-gray-500"
                          src={zap.trigger.trigger.image}
                        />
                      </Tooltip>
                      {zap.actions.map((a, i) => (
                        <div key={i}>
                          <Tooltip tooltipText={a.action.type}>
                            <img
                              key={i}
                              className="w-6 p-[3px] border border-gray-500"
                              src={a.action.image}
                            />
                          </Tooltip>
                        </div>
                      ))}
                    </td>
                    <td className="font-normal py-3 text-start">
                      <div className="flex gap-10">
                        {url}
                        <svg
                          onClick={() => handleUrlCopy(url)}
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          fill="#FFFFFF"
                          stroke="#695BE8"
                          className="size-6 cursor-pointer"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75"
                          />
                        </svg>
                      </div>
                    </td>
                    <td className="font-normal py-3 text-start">
                      {formatDateTimeToCustomString(zap.createdDate)}
                    </td>
                    <td className="font-normal py-3 text-center">
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={zap.isActive}
                          onChange={(e) => toggleZapExecution(e, zap)}
                          className="sr-only peer"
                        />
                        <div className="relative z-10 w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-700"></div>
                      </label>
                    </td>
                    <td
                      onClick={() =>
                        selectedRow === -1 ? setSelectedRow(index) : setSelectedRow(-1)
                      }
                      id={index.toString()}
                      className="font-normal py-4 text-start w-5 cursor-pointer flex relative"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="size-6"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10.5 6a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm0 6a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm0 6a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {index === selectedRow && (
                        <div className="absolute bg-white px-3 py-2 flex flex-col gap-2 right-5 -top-1 border border-gray-300 rounded-md z-[999]">
                          <div
                            onClick={() => setRenameEnabled(index)}
                            className="hover:bg-violet-100 flex items-center gap-1 text-secondary-500 py-1 px-2 rounded-md"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="size-5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
                              />
                            </svg>
                            Rename
                          </div>
                          <div
                            onClick={() => {
                              setHistoryZap(zap);
                              setSelectedRow(-1);
                            }}
                            className="hover:bg-blue-100 flex items-center gap-1 text-blue-600 py-1 px-2 rounded-md"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="size-5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                              />
                            </svg>
                            History
                          </div>
                          <div
                            onClick={() => handleZapDelete(zap)}
                            className="hover:bg-red-100 flex items-center gap-1 text-red-600 py-1 px-2 rounded-md"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="size-5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                            Delete
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {/* Mobile Card Layout - Visible only on mobile */}
        <div className="md:hidden flex flex-col gap-3">
          {data.total > 0 &&
            data?.zaps?.map((zap: TZap, index) => {
              // @ts-ignore
              const url = `${HOOKS_URL}/hooks/${session?.user?.id}/${zap.id}`;
              const parsedData = JSON.stringify(zap.id);

              return (
                <div
                  key={zap.id}
                  className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm"
                >
                  {/* Header: Name + Toggle */}
                  <div className="flex justify-between items-center mb-2">
                    <Link
                      className="font-medium text-secondary-700 hover:underline text-sm xs:text-base truncate max-w-[60%]"
                      href={{ pathname: '/editor', query: { zapId: parsedData } }}
                    >
                      {zap.name}
                    </Link>
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={zap.isActive}
                        onChange={(e) => toggleZapExecution(e, zap)}
                        className="sr-only peer"
                      />
                      <div className="relative w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-green-700 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                  </div>

                  {/* Flow Icons */}
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-xs text-gray-500 mr-1">Flow:</span>
                    <img
                      className="w-5 h-5 border p-[2px] border-gray-400 rounded"
                      src={zap.trigger.trigger.image}
                      alt={zap.trigger.trigger.type}
                    />
                    <span className="text-gray-400">→</span>
                    {zap.actions.map((a, i) => (
                      <img
                        key={i}
                        className="w-5 h-5 p-[2px] border border-gray-400 rounded"
                        src={a.action.image}
                        alt={a.action.type}
                      />
                    ))}
                  </div>

                  {/* Date */}
                  <p className="text-xs text-gray-500 mb-2">
                    {formatDateTimeToCustomString(zap.createdDate)}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => handleUrlCopy(url)}
                      className="flex-1 text-xs py-2 px-3 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 flex items-center justify-center gap-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                        <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                      </svg>
                      Copy URL
                    </button>
                    <button
                      onClick={() => setHistoryZap(zap)}
                      className="text-xs py-2 px-3 bg-blue-50 hover:bg-blue-100 rounded text-blue-600 flex items-center justify-center gap-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      History
                    </button>
                    <button
                      onClick={() => handleZapDelete(zap)}
                      className="text-xs py-2 px-3 bg-red-50 hover:bg-red-100 rounded text-red-600 flex items-center justify-center gap-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          {data.total === 0 && !loading && (
            <div className="text-center text-gray-500 py-8">
              No zaps yet. Create your first one!
            </div>
          )}
        </div>
      </div>

      {/* Zap Run History Modal */}
      {historyZap && (
        <ZapRunHistory
          zapId={historyZap.id}
          zapName={historyZap.name || 'Untitled'}
          isOpen={!!historyZap}
          onClose={() => setHistoryZap(null)}
        />
      )}
    </MainSection>
  );
}
