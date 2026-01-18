'use client';
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import Button from './Button';
import { API_URL } from '@/lib/config';

interface WhatsAppServer {
    id: string;
    displayName: string;
    phoneNumber: string;
}

interface WhatsAppTrigger {
    id: string;
    eventType: string;
    isActive: boolean;
    lastProcessedAt: string | null;
    server: WhatsAppServer;
    zap?: {
        id: string;
        name: string;
    };
}

interface Props {
    zapId?: string;
    onTriggerCreated?: (trigger: any) => void;
}

const WhatsAppTriggerConfig = ({ zapId, onTriggerCreated }: Props) => {
    const [servers, setServers] = useState<WhatsAppServer[]>([]);
    const [triggers, setTriggers] = useState<WhatsAppTrigger[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [selectedServer, setSelectedServer] = useState('');
    const [eventType, setEventType] = useState('message_received');

    const eventTypes = [
        { value: 'message_received', label: 'Message Received', description: 'Trigger when someone sends you a message' },
        { value: 'message_delivered', label: 'Message Delivered', description: 'Trigger when your message is delivered' },
        { value: 'message_read', label: 'Message Read', description: 'Trigger when your message is read' },
    ];

    const fetchServers = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await axios.get(`${API_URL}/api/whatsapp/servers`, {
                headers: { Authorization: token }
            });

            setServers(response.data.servers || []);
        } catch (error: any) {
            toast.error('Failed to fetch WhatsApp servers');
        }
    };

    const fetchTriggers = async () => {
        try {
            setIsLoading(true);
            const token = localStorage.getItem('token');
            if (!token) return;

            const url = zapId
                ? `${API_URL}/api/whatsapp/triggers?zapId=${zapId}`
                : `${API_URL}/api/whatsapp/triggers`;

            const response = await axios.get(url, {
                headers: { Authorization: token }
            });

            setTriggers(response.data.triggers || []);
        } catch (error: any) {
            toast.error('Failed to fetch triggers');
        } finally {
            setIsLoading(false);
        }
    };

    const createTrigger = async () => {
        if (!selectedServer) {
            toast.error('Please select a WhatsApp account');
            return;
        }

        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await axios.post(`${API_URL}/api/whatsapp/triggers`, {
                serverId: selectedServer,
                zapId: zapId,
                eventType: eventType
            }, {
                headers: { Authorization: token }
            });

            toast.success('WhatsApp trigger created!');
            setShowCreateForm(false);
            setSelectedServer('');
            fetchTriggers();

            if (onTriggerCreated) {
                onTriggerCreated(response.data.trigger);
            }
        } catch (error: any) {
            toast.error('Failed to create trigger: ' + (error.response?.data?.message || error.message));
        }
    };

    const deleteTrigger = async (triggerId: string) => {
        if (!confirm('Delete this WhatsApp trigger?')) return;

        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            await axios.delete(`${API_URL}/api/whatsapp/triggers/${triggerId}`, {
                headers: { Authorization: token }
            });

            toast.success('Trigger deleted');
            fetchTriggers();
        } catch (error: any) {
            toast.error('Failed to delete trigger');
        }
    };

    useEffect(() => {
        fetchServers();
        fetchTriggers();
    }, [zapId]);

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">WhatsApp Triggers</h2>
                <Button variant="primary" onClick={() => setShowCreateForm(!showCreateForm)}>
                    {showCreateForm ? 'Cancel' : 'New Trigger'}
                </Button>
            </div>

            {showCreateForm && (
                <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                    <h3 className="text-lg font-semibold mb-4">Create WhatsApp Trigger</h3>

                    {servers.length === 0 ? (
                        <div className="text-center py-4 text-gray-500">
                            <p>No WhatsApp accounts connected.</p>
                            <p className="text-sm mt-1">Connect a WhatsApp account first.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    WhatsApp Account
                                </label>
                                <select
                                    value={selectedServer}
                                    onChange={(e) => setSelectedServer(e.target.value)}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Select account...</option>
                                    {servers.map((server) => (
                                        <option key={server.id} value={server.id}>
                                            {server.displayName} ({server.phoneNumber || 'No number'})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Event Type
                                </label>
                                <select
                                    value={eventType}
                                    onChange={(e) => setEventType(e.target.value)}
                                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-500"
                                >
                                    {eventTypes.map((type) => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-sm text-gray-500 mt-1">
                                    {eventTypes.find(t => t.value === eventType)?.description}
                                </p>
                            </div>

                            <Button variant="primary" onClick={createTrigger}>
                                Create Trigger
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {isLoading ? (
                <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto"></div>
                </div>
            ) : triggers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <p>No WhatsApp triggers configured.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {triggers.map((trigger) => (
                        <div key={trigger.id} className="bg-white p-4 rounded-lg shadow-md">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-semibold flex items-center gap-2">
                                        <span className="text-green-500">📱</span>
                                        {eventTypes.find(t => t.value === trigger.eventType)?.label || trigger.eventType}
                                    </h4>
                                    <p className="text-sm text-gray-600">
                                        Account: {trigger.server?.displayName}
                                    </p>
                                    {trigger.zap && (
                                        <p className="text-sm text-gray-600">
                                            Zap: {trigger.zap.name}
                                        </p>
                                    )}
                                    {trigger.lastProcessedAt && (
                                        <p className="text-sm text-gray-500">
                                            Last triggered: {new Date(trigger.lastProcessedAt).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 text-xs rounded-full ${trigger.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                        {trigger.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                    <Button variant="link" size="sm" onClick={() => deleteTrigger(trigger.id)}>
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WhatsAppTriggerConfig;
