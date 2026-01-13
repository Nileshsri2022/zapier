'use client';
import axios from 'axios';
import React, { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'react-toastify';
import FormInput from './FormInput';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface AvailableItem {
    id: string,
    type: string,
    image: string
}

const Modal = ({ isVisible, setIsVisible, onClick }: {
    isVisible: number,
    setIsVisible: Dispatch<SetStateAction<number>>,
    onClick?: (selectedItem: any) => void
}) => {
    const [availableItem, setAvailableItem] = useState<AvailableItem[] | []>([]);
    const [selectedItem, setSelectedItem] = useState<any>();
    const [page, setPage] = useState<number>(1);

    const handleSaveMetaData = (data: any) => {
        onClick && onClick({ ...selectedItem, metadata: data });
    }

    const fetchAvailableTriggers = async () => {
        try {
            const token = typeof localStorage !== 'undefined' ? localStorage.getItem("token") : null;
            if (!token) {
                toast.error("No authentication token found");
                return;
            }
            const response = await axios.get(`${API_URL}/api/triggers`, {
                headers: {
                    Authorization: token
                }
            });
            setAvailableItem(response?.data?.avialableTriggers || []);
        } catch (error) {
            toast.error(error as string)
        }
    }

    const fetchAvailableActions = async () => {
        try {
            const token = typeof localStorage !== 'undefined' ? localStorage.getItem("token") : null;
            if (!token) {
                toast.error("No authentication token found");
                return;
            }
            const response = await axios.get(`${API_URL}/api/actions`, {
                headers: {
                    Authorization: token
                }
            });
            setAvailableItem(response?.data?.availableActions || []);
        } catch (error) {
            toast.error(error as string)
        }
    }

    useEffect(() => {
        if (page === 1 && isVisible !== 0) {
            if (isVisible === 1) {
                fetchAvailableTriggers();
            } else if (isVisible > 1) {
                fetchAvailableActions();
            }
        }

        return (() => {
            setAvailableItem([]);
        })
    }, [isVisible, page])

    const selectAction = (
        <div className='flex flex-col gap-2 mt-4'>
            {availableItem.length === 0 ? (
                <div className='text-center text-gray-500 py-4'>
                    No {isVisible === 1 ? 'triggers' : 'actions'} available
                </div>
            ) : (
                availableItem.map((item) => (
                    <div onClick={() => {
                        setSelectedItem(item);
                        if (isVisible > 1)
                            setPage(a => a + 1)
                        else {
                            onClick && onClick(item);
                        }
                    }} key={item?.id} className='flex gap-1 items-center cursor-pointer transition-all hover:bg-link-bg rounded-md'>
                        <img className='h-6 w-6' alt={item?.type} src={item?.image} />
                        <p>{item?.type}</p>
                    </div>
                ))
            )}
        </div>
    )

    const actionMetaData = (
        <div>
            {selectedItem?.type === 'Email' ? <EmailMetaData handleClick={handleSaveMetaData} /> :
                selectedItem?.type === 'Solana' ? <SolanaMetaData handleClick={handleSaveMetaData} /> :
                    selectedItem?.type?.includes('Gmail') ? <GmailMetaData handleClick={handleSaveMetaData} selectedType={selectedItem?.type} /> :
                        <div className='text-center text-gray-500 py-4'>No configuration needed</div>}
        </div>
    )

    const triggerMetaData = (
        <div>
            {selectedItem?.type === 'Webhook' ? <WebhookMetaData handleClick={handleSaveMetaData} /> : null}
        </div>
    )

    return (
        <div className={'absolute justify-center items-center bg-modal-bg h-screen w-screen top-0 left-0 flex transition-all'}
        >
            <div className='bg-white w-[40rem] min-h-96 rounded-md shadow-lg p-4 animate-zoom_in'>
                <div className='flex items-center justify-between pb-2 border-b border-b-gray-300'>
                    <h3 className='font-semibold text-lg'>{`Select ${isVisible === 1 ? 'Trigger' : isVisible > 1 ? 'Action' : ''}`}</h3>
                    <svg onClick={() => setIsVisible(0)} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000" className="size-6 cursor-pointer">
                        <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                </div>
                {(page === 1) ? selectAction : (isVisible === 1 ? triggerMetaData : actionMetaData)}
            </div>
        </div>
    )

}

const EmailMetaData = ({ handleClick }: {
    handleClick: (data: any) => void
}) => {
    const [formData, setFormData] = useState({
        to: "",
        subject: "",
        body: ""
    });

    const handleFormDataChange = (e: any) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
    }

    return (
        <div className='my-4 flex flex-col gap-4 text-secondary-500'>
            <FormInput label='To' name='to' onChange={handleFormDataChange} />
            <FormInput label='Subject' name='subject' onChange={handleFormDataChange} />
            <textarea className='text-black rounded-sm border border-gray-400 p-2 bg-base-100' placeholder='Email content...' rows={8} name='body' onChange={handleFormDataChange} />
            <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
        </div>
    )
}

const SolanaMetaData = ({ handleClick }: {
    handleClick: (data: any) => void
}) => {
    const [formData, setFormData] = useState({
        address: "",
        amount: ""
    });

    const handleFormDataChange = (e: any) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
    }

    return (
        <div className='my-4 flex flex-col gap-4 text-secondary-500'>
            <FormInput label='Address' name='address' onChange={handleFormDataChange} />
            <FormInput label='Amount' name='amount' onChange={handleFormDataChange} />
            <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
        </div>
    )
}

const WebhookMetaData = ({ handleClick }: {
    handleClick: (data: any) => void
}) => {
    const [formData, setFormData] = useState({
        url: "",
        method: "POST",
        headers: "{}"
    });

    const handleFormDataChange = (e: any) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
    }

    return (
        <div className='my-4 flex flex-col gap-4 text-secondary-500'>
            <FormInput label='Webhook URL' name='url' placeholder='https://your-app.com/webhook' onChange={handleFormDataChange} />
            <div>
                <label className='block text-sm font-medium mb-1'>Method</label>
                <select name='method' value={formData.method} onChange={handleFormDataChange} className='w-full p-2 border border-gray-300 rounded-md'>
                    <option value='POST'>POST</option>
                    <option value='GET'>GET</option>
                    <option value='PUT'>PUT</option>
                    <option value='PATCH'>PATCH</option>
                </select>
            </div>
            <FormInput label='Headers (JSON)' name='headers' placeholder='{"Content-Type": "application/json"}' onChange={handleFormDataChange} />
            <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
        </div>
    )
}

const GmailMetaData = ({ handleClick, selectedType }: {
    handleClick: (data: any) => void;
    selectedType: string;
}) => {
    const [formData, setFormData] = useState({
        to: "",
        subject: "",
        body: "",
        labelName: "",
        replyMessage: "",
        senderFilter: "",
        subjectFilter: "",
        watchedLabels: ""
    });

    const handleFormDataChange = (e: any) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
    }

    const renderGmailForm = () => {
        switch (selectedType) {
            case 'Gmail Send Email':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <FormInput label='To' name='to' placeholder='recipient@example.com' onChange={handleFormDataChange} />
                        <FormInput label='Subject' name='subject' placeholder='Email subject' onChange={handleFormDataChange} />
                        <textarea
                            className='text-black rounded-sm border border-gray-400 p-2 bg-base-100'
                            placeholder='Email content...'
                            rows={8}
                            name='body'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            case 'Gmail Reply':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <textarea
                            className='text-black rounded-sm border border-gray-400 p-2 bg-base-100'
                            placeholder='Reply message...'
                            rows={8}
                            name='replyMessage'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            case 'Gmail Add Label':
            case 'Gmail Remove Label':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <FormInput
                            label={`${selectedType === 'Gmail Add Label' ? 'Add' : 'Remove'} Label`}
                            name='labelName'
                            placeholder='Label name'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            case 'Gmail Mark as Read':
            case 'Gmail Archive':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <p className='text-sm text-gray-600'>No additional configuration needed for this action.</p>
                        <Button variant='secondary' onClick={() => handleClick({})}>Save</Button>
                    </div>
                );
            case 'Gmail New Email':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <FormInput
                            label='Sender Filter (optional)'
                            name='senderFilter'
                            placeholder='sender@example.com'
                            onChange={handleFormDataChange}
                        />
                        <FormInput
                            label='Subject Filter (optional)'
                            name='subjectFilter'
                            placeholder='Contains keyword'
                            onChange={handleFormDataChange}
                        />
                        <FormInput
                            label='Watch Labels (optional)'
                            name='watchedLabels'
                            placeholder='INBOX,SENT,IMPORTANT'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            case 'Gmail Labeled':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <FormInput
                            label='Watch Labels'
                            name='watchedLabels'
                            placeholder='INBOX,SENT,IMPORTANT'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            case 'Gmail Starred':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <p className='text-sm text-gray-600'>No additional configuration needed for starred emails trigger.</p>
                        <Button variant='secondary' onClick={() => handleClick({})}>Save</Button>
                    </div>
                );
            case 'Gmail From Sender':
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <FormInput
                            label='Sender Email'
                            name='senderFilter'
                            placeholder='sender@example.com'
                            onChange={handleFormDataChange}
                        />
                        <Button variant='secondary' onClick={() => handleClick(formData)}>Save</Button>
                    </div>
                );
            default:
                return (
                    <div className='my-4 flex flex-col gap-4 text-secondary-500'>
                        <p className='text-sm text-gray-600'>Unknown Gmail action type.</p>
                        <Button variant='secondary' onClick={() => handleClick({})}>Save</Button>
                    </div>
                );
        }
    };

    return renderGmailForm();
}

export default Modal
