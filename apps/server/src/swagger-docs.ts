/**
 * @swagger
 * /auth/signup:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: User created successfully
 *       400:
 *         description: User already exists
 */

/**
 * @swagger
 * /auth/signin:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in to existing account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user info
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       403:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /zaps:
 *   get:
 *     tags: [Zaps]
 *     summary: Get all zaps for current user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's zaps
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 zaps:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Zap'
 *   post:
 *     tags: [Zaps]
 *     summary: Create a new zap
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [triggerId, actions]
 *             properties:
 *               triggerId:
 *                 type: string
 *               triggerMetadata:
 *                 type: object
 *               actions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     actionId:
 *                       type: string
 *                     metadata:
 *                       type: object
 *     responses:
 *       200:
 *         description: Zap created successfully
 */

/**
 * @swagger
 * /zaps/{zapId}:
 *   get:
 *     tags: [Zaps]
 *     summary: Get a specific zap
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Zap details
 *       404:
 *         description: Zap not found
 *   delete:
 *     tags: [Zaps]
 *     summary: Delete a zap
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Zap deleted
 */

/**
 * @swagger
 * /zaps/{zapId}/enable:
 *   patch:
 *     tags: [Zaps]
 *     summary: Enable or disable a zap
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Zap status updated
 */

/**
 * @swagger
 * /triggers:
 *   get:
 *     tags: [Triggers]
 *     summary: Get all available triggers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available triggers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 avialableTriggers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Trigger'
 */

/**
 * @swagger
 * /actions:
 *   get:
 *     tags: [Actions]
 *     summary: Get all available actions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available actions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 availableActions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Action'
 */

/**
 * @swagger
 * /trigger/webhook/{zapId}:
 *   post:
 *     tags: [Triggers]
 *     summary: Trigger a zap via webhook
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any JSON payload
 *     responses:
 *       200:
 *         description: Webhook received
 *       404:
 *         description: Zap not found
 */

/**
 * @swagger
 * /gmail/auth:
 *   get:
 *     tags: [Gmail]
 *     summary: Start Gmail OAuth flow
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Returns OAuth URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 */

/**
 * @swagger
 * /gmail/servers:
 *   get:
 *     tags: [Gmail]
 *     summary: Get connected Gmail accounts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Gmail servers
 */

/**
 * @swagger
 * /sheets/auth:
 *   get:
 *     tags: [Google Sheets]
 *     summary: Start Google Sheets OAuth flow
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Returns OAuth URL
 */

/**
 * @swagger
 * /sheets/servers:
 *   get:
 *     tags: [Google Sheets]
 *     summary: Get connected Google Sheets accounts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Google Sheets servers
 */

/**
 * @swagger
 * /calendar/auth:
 *   get:
 *     tags: [Google Calendar]
 *     summary: Start Google Calendar OAuth flow
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Returns OAuth URL
 */

/**
 * @swagger
 * /calendar/servers:
 *   get:
 *     tags: [Google Calendar]
 *     summary: Get connected Google Calendar accounts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of calendar servers
 */

/**
 * @swagger
 * /telegram/bots:
 *   get:
 *     tags: [Telegram]
 *     summary: Get connected Telegram bots
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Telegram bots
 *   post:
 *     tags: [Telegram]
 *     summary: Connect a new Telegram bot
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [botToken, botName]
 *             properties:
 *               botToken:
 *                 type: string
 *               botName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bot connected
 */

/**
 * @swagger
 * /whatsapp/servers:
 *   get:
 *     tags: [WhatsApp]
 *     summary: Get connected WhatsApp numbers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of WhatsApp servers
 *   post:
 *     tags: [WhatsApp]
 *     summary: Connect a new WhatsApp number
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *               accessToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: WhatsApp connected
 */

/**
 * @swagger
 * /github/webhook/{zapId}:
 *   post:
 *     tags: [GitHub]
 *     summary: GitHub webhook endpoint
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: X-GitHub-Event
 *         required: true
 *         schema:
 *           type: string
 *           enum: [push, pull_request, issues, release]
 *       - in: header
 *         name: X-Hub-Signature-256
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed
 */

/**
 * @swagger
 * /schedule/triggers/{zapId}:
 *   get:
 *     tags: [Schedule]
 *     summary: Get schedule trigger for a zap
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: zapId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Schedule trigger details
 */

export {};
