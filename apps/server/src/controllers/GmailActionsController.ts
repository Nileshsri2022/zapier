import { Request, Response } from 'express';
import client from '@repo/db';
import { GmailService } from '../services/GmailService';

export const executeGmailAction = async (actionType: string, metadata: any, triggerPayload: any) => {
  // This would be called from the main ActionsController
  // For now, we'll implement the core logic here

  switch (actionType) {
    case 'GmailSend':
      return await executeGmailSendAction(metadata, triggerPayload);
    case 'GmailReply':
      return await executeGmailReplyAction(metadata, triggerPayload);
    case 'GmailAddLabel':
      return await executeGmailAddLabelAction(metadata, triggerPayload);
    case 'GmailRemoveLabel':
      return await executeGmailRemoveLabelAction(metadata, triggerPayload);
    case 'GmailMarkRead':
      return await executeGmailMarkReadAction(metadata, triggerPayload);
    case 'GmailArchive':
      return await executeGmailArchiveAction(metadata, triggerPayload);
    default:
      throw new Error(`Unsupported Gmail action type: ${actionType}`);
  }
};

const executeGmailSendAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, to, subject, body, cc, bcc } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    // Replace placeholders in email content
    const processedTo = replacePlaceholders(to, triggerPayload);
    const processedSubject = replacePlaceholders(subject, triggerPayload);
    const processedBody = replacePlaceholders(body, triggerPayload);
    const processedCc = cc ? replacePlaceholders(cc, triggerPayload) : undefined;
    const processedBcc = bcc ? replacePlaceholders(bcc, triggerPayload) : undefined;

    const messageId = await gmailService.sendEmail(
      Array.isArray(processedTo) ? processedTo : [processedTo],
      processedSubject,
      processedBody,
      processedCc ? (Array.isArray(processedCc) ? processedCc : [processedCc]) : undefined,
      processedBcc ? (Array.isArray(processedBcc) ? processedBcc : [processedBcc]) : undefined
    );

    console.log(`Gmail email sent successfully: ${messageId}`);
    return { messageId, success: true };
  } catch (error) {
    console.error('Gmail send action failed:', error);
    throw error;
  }
};

const executeGmailReplyAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, messageId, body, replyAll } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    const processedBody = replacePlaceholders(body, triggerPayload);
    const processedMessageId = replacePlaceholders(messageId, triggerPayload);

    const replyMessageId = await gmailService.replyToEmail(
      processedMessageId,
      processedBody,
      replyAll
    );

    console.log(`Gmail reply sent successfully: ${replyMessageId}`);
    return { messageId: replyMessageId, success: true };
  } catch (error) {
    console.error('Gmail reply action failed:', error);
    throw error;
  }
};

const executeGmailAddLabelAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, messageId, labelIds } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    const processedMessageId = replacePlaceholders(messageId, triggerPayload);
    const processedLabelIds = Array.isArray(labelIds)
      ? labelIds.map((id: string) => replacePlaceholders(id, triggerPayload))
      : [replacePlaceholders(labelIds, triggerPayload)];

    await gmailService.addLabels(processedMessageId, processedLabelIds);

    console.log(`Gmail labels added successfully to message: ${processedMessageId}`);
    return { messageId: processedMessageId, success: true };
  } catch (error) {
    console.error('Gmail add label action failed:', error);
    throw error;
  }
};

const executeGmailRemoveLabelAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, messageId, labelIds } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    const processedMessageId = replacePlaceholders(messageId, triggerPayload);
    const processedLabelIds = Array.isArray(labelIds)
      ? labelIds.map((id: string) => replacePlaceholders(id, triggerPayload))
      : [replacePlaceholders(labelIds, triggerPayload)];

    await gmailService.removeLabels(processedMessageId, processedLabelIds);

    console.log(`Gmail labels removed successfully from message: ${processedMessageId}`);
    return { messageId: processedMessageId, success: true };
  } catch (error) {
    console.error('Gmail remove label action failed:', error);
    throw error;
  }
};

const executeGmailMarkReadAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, messageId, isRead } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    const processedMessageId = replacePlaceholders(messageId, triggerPayload);
    const processedIsRead = isRead !== undefined ? replacePlaceholders(String(isRead), triggerPayload) === 'true' : true;

    await gmailService.markAsRead(processedMessageId, processedIsRead);

    console.log(`Gmail message marked as ${processedIsRead ? 'read' : 'unread'}: ${processedMessageId}`);
    return { messageId: processedMessageId, success: true };
  } catch (error) {
    console.error('Gmail mark read action failed:', error);
    throw error;
  }
};

const executeGmailArchiveAction = async (metadata: any, triggerPayload: any) => {
  try {
    const { serverId, messageId } = metadata;

    const gmailService = await getGmailService(serverId);
    if (!gmailService) {
      throw new Error('Gmail service not found or inactive');
    }

    const processedMessageId = replacePlaceholders(messageId, triggerPayload);

    await gmailService.archiveEmail(processedMessageId);

    console.log(`Gmail message archived successfully: ${processedMessageId}`);
    return { messageId: processedMessageId, success: true };
  } catch (error) {
    console.error('Gmail archive action failed:', error);
    throw error;
  }
};

// Helper function to get Gmail service instance
const getGmailService = async (serverId: string): Promise<GmailService | null> => {
  try {
    // For now, we'll create a mock service since we can't access the database models yet
    // In the full implementation, this would fetch from the database
    console.log(`Getting Gmail service for server: ${serverId}`);
    return null; // Placeholder
  } catch (error) {
    console.error('Error creating Gmail service:', error);
    return null;
  }
};

// Helper function to replace placeholders in text
const replacePlaceholders = (template: string, data: any): string => {
  if (!template || typeof template !== 'string') {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
};
