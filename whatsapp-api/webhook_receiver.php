<?php
/**
 * WhatsApp API - Webhook Receiver & Live Dashboard
 * 
 * Features:
 * - ✅ Webhook signature verification  
 * - ✅ Real-time live logs dashboard
 * - ✅ JSON storage with last 100 events
 * - ✅ Debug mode for troubleshooting
 * - ✅ XSS protection
 */

declare(strict_types=1);

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

$SECRET = getenv('WEBHOOK_SECRET') ?: '';
$DEBUG_MODE = filter_var(getenv('WEBHOOK_DEBUG') ?: 'false', FILTER_VALIDATE_BOOLEAN);
$ERROR_LOG_FILE = __DIR__ . '/webhook_errors.log';

$LOG_DIR = __DIR__;
$LOG_FILE = $LOG_DIR . '/webhook_log.json';

// Debug logging function
function debug_log($message, $data = null) {
    global $DEBUG_MODE, $ERROR_LOG_FILE;
    if ($DEBUG_MODE) {
        $timestamp = date('Y-m-d H:i:s');
        $msg = "[$timestamp] $message";
        if ($data) {
            $msg .= " | " . json_encode($data);
        }
        $msg .= "\n";
        @file_put_contents($ERROR_LOG_FILE, $msg, FILE_APPEND);
    }
}

// Initialize log file if doesn't exist
if (!file_exists($LOG_FILE)) {
    $initial = json_encode([], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    file_put_contents($LOG_FILE, $initial, LOCK_EX);
    chmod($LOG_FILE, 0644);
}

// ═══════════════════════════════════════════════════════════
// HEADERS
// ═══════════════════════════════════════════════════════════

header('X-Powered-By: WhatsApp-API-Webhook/1.0');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Webhook-Signature, X-Webhook-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ═══════════════════════════════════════════════════════════
// LIVE LOGS DASHBOARD (GET REQUEST)
// ═══════════════════════════════════════════════════════════

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['ajax'])) {
    header('Content-Type: application/json; charset=utf-8');

    $logs = json_decode((string)@file_get_contents($LOG_FILE), true) ?: [];
    $totalCount = count($logs);
    $lastHour = array_filter($logs, fn($log) => 
        (time() - strtotime($log['time'] ?? 'now')) < 3600
    );

    $users = array_unique(array_map(fn($log) => $log['data']['userId'] ?? 'unknown', $logs));
    $sessions = array_unique(array_map(fn($log) => $log['data']['sessionId'] ?? 'unknown', $logs));

    echo json_encode([
        'success' => true,
        'logs' => array_reverse($logs),
        'total' => $totalCount,
        'lastHour' => count($lastHour),
        'timestamp' => date('Y-m-d H:i:s'),
        'uniqueUsers' => count($users),
        'uniqueSessions' => count($sessions),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Dashboard page
    $logs = json_decode((string)@file_get_contents($LOG_FILE), true) ?: [];
    $totalEvents = count($logs);
    $errorLogExists = file_exists($ERROR_LOG_FILE);
    $errorLog = $errorLogExists ? file_get_contents($ERROR_LOG_FILE) : '';
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Webhook Logs</title>
        <style>
            * { box-sizing: border-box; }
            body {
                margin: 0;
                padding: 20px;
                background: linear-gradient(135deg, #0b0b0b 0%, #1a1a1a 100%);
                color: #fff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            .topbar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 20px;
                flex-wrap: wrap;
                margin-bottom: 30px;
                background: rgba(255, 255, 255, 0.05);
                padding: 20px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            h1 { margin: 0; font-size: 32px; font-weight: 700; }
            .stats {
                display: flex;
                gap: 20px;
                flex-wrap: wrap;
            }
            .stat-item {
                background: rgba(127, 200, 152, 0.1);
                padding: 12px 18px;
                border-radius: 8px;
                border-left: 3px solid #7fc898;
            }
            .stat-label {
                color: #bbb;
                font-size: 12px;
                text-transform: uppercase;
                display: block;
                margin-bottom: 4px;
            }
            .stat-value {
                font-weight: bold;
                color: #7CFC98;
                font-size: 20px;
            }
            .status {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(127, 200, 152, 0.1);
                padding: 10px 16px;
                border-radius: 8px;
            }
            .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #7CFC98;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .debug-section {
                background: rgba(76, 175, 80, 0.1);
                border: 1px solid rgba(76, 175, 80, 0.3);
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 20px;
                max-height: 300px;
                overflow-y: auto;
            }
            .debug-title {
                font-weight: bold;
                color: #66BB6A;
                margin-bottom: 10px;
            }
            .debug-content {
                background: #222;
                padding: 10px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 11px;
                white-space: pre-wrap;
                word-wrap: break-word;
                color: #aaa;
            }
            .log { background: rgba(24, 24, 24, 0.8); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 16px; margin-bottom: 12px; }
            .log:hover { background: rgba(30, 30, 30, 0.9); }
            .log-time { font-weight: bold; color: #8fd3ff; font-size: 13px; }
            .log-event { display: inline-block; background: rgba(127, 200, 152, 0.2); color: #7CFC98; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
            .log-content { background: rgba(34, 34, 34, 0.9); padding: 12px; border-radius: 8px; overflow-x: auto; margin-top: 10px; }
            pre { margin: 0; font-family: 'Courier New', monospace; font-size: 12px; color: #d4d4d4; white-space: pre-wrap; }
            .empty { background: rgba(24, 24, 24, 0.8); padding: 40px 20px; border-radius: 10px; color: #888; text-align: center; border: 2px dashed rgba(255, 255, 255, 0.1); }
            .logs-container { max-height: 600px; overflow-y: auto; }
            .btn { padding: 10px 16px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: all 0.3s; margin-bottom: 10px; }
            .btn-primary { background: #7CFC98; color: #000; }
            .btn-primary:hover { background: #6fe485; }
            .btn-danger { background: #ff6b6b; color: #fff; }
            .btn-danger:hover { background: #ff5252; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="topbar">
                <h1>��� WhatsApp Webhook Logs</h1>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-label">Total Events</span>
                        <span class="stat-value" id="totalCount"><?= count($logs); ?></span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Last Hour</span>
                        <span class="stat-value" id="lastHourCount">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Users</span>
                        <span class="stat-value" id="uniqueUsers">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Sessions</span>
                        <span class="stat-value" id="uniqueSessions">0</span>
                    </div>
                </div>
                <div class="status">
                    <div class="status-dot" id="statusDot"></div>
                    <span class="status-text" id="statusText">Checking...</span>
                </div>
            </div>

            <?php if ($DEBUG_MODE && $errorLog): ?>
            <div class="debug-section">
                <div class="debug-title">✅ Debug Log (Last 20 lines):</div>
                <div class="debug-content"><?= htmlspecialchars(implode("\n", array_slice(explode("\n", $errorLog), -20))); ?></div>
                <button class="btn btn-danger" onclick="clearDebugLog()">Clear Debug Log</button>
            </div>
            <?php endif; ?>

            <div class="logs-container" id="logs">
                <div class="empty">
                    <div style="font-size: 48px; margin-bottom: 10px;">���</div>
                    <div>No webhook events logged yet...</div>
                    <div style="font-size: 12px; margin-top: 8px; color: #666;">
                        Waiting for WhatsApp webhook events
                    </div>
                </div>
            </div>

            <div>
                <button class="btn btn-primary" onclick="refreshLogs()">��� Refresh</button>
                <button class="btn btn-danger" onclick="clearLogs()">���️ Clear Logs</button>
            </div>
        </div>

        <script>
            let allLogs = [];

            async function loadLogs() {
                try {
                    const res = await fetch('?ajax=1&_=' + Date.now());
                    const data = await res.json();
                    if (!data.success) return;
                    
                    document.getElementById('totalCount').textContent = data.total || 0;
                    document.getElementById('lastHourCount').textContent = data.lastHour || 0;
                    document.getElementById('uniqueUsers').textContent = data.uniqueUsers || 0;
                    document.getElementById('uniqueSessions').textContent = data.uniqueSessions || 0;
                    
                    allLogs = data.logs || [];
                    renderLogs(allLogs);
                } catch (e) {
                    console.error('Error:', e);
                }
            }

            function renderLogs(logs) {
                const box = document.getElementById('logs');
                if (!logs.length) {
                    box.innerHTML = `
                        <div class="empty">
                            <div style="font-size: 48px;">���</div>
                            <div>No events found</div>
                        </div>
                    `;
                    return;
                }
                const html = logs.map(log => `
                    <div class="log">
                        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                            <span class="log-time">��� ${escapeHtml(log.time)}</span>
                            <span class="log-event">${escapeHtml(log.data?.event || 'unknown')}</span>
                        </div>
                        <div style="font-size: 12px; color: #888; margin: 10px 0;">
                            ��� User: <code style="background: #333; padding: 2px 6px;">${escapeHtml((log.data?.userId || 'N/A').substring(0, 12))}...</code>
                            | ��� Session: <code style="background: #333; padding: 2px 6px;">${escapeHtml((log.data?.sessionId || 'N/A').substring(0, 12))}...</code>
                        </div>
                        <div class="log-content"><pre>${escapeHtml(JSON.stringify(log.data, null, 2))}</pre></div>
                    </div>
                `).join('');
                box.innerHTML = html;
            }

            function escapeHtml(str) {
                str = String(str || '');
                return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            function refreshLogs() { loadLogs(); window.location.reload(); }
            function clearLogs() {
                if (confirm('Clear all logs?')) fetch('.', {method: 'POST', body: JSON.stringify({action: 'clear'})}).then(() => loadLogs());
            }
            function clearDebugLog() {
                fetch('.', {method: 'POST', body: JSON.stringify({action: 'clear_debug'})}).then(() => location.reload());
            }

            loadLogs();
            setInterval(loadLogs, 2000);
        </script>
    </body>
    </html>
    <?php
    exit;
}

// ═══════════════════════════════════════════════════════════
// WEBHOOK RECEIVER (POST REQUEST)
// ═══════════════════════════════════════════════════════════

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');

    $input = @file_get_contents('php://input');
    $parsed = @json_decode($input, true) ?: [];

    if ($SECRET === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'error' => 'Webhook receiver secret is not configured']);
        exit;
    }

    $receivedSecret = $_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? '';
    $receivedSignature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';
    $expectedSignature = 'sha256=' . hash_hmac('sha256', $input, $SECRET);
    debug_log("WEBHOOK_POST", [
        "received_secret_length" => strlen($receivedSecret),
        "expected_secret_length" => strlen($SECRET),
        "secret_match" => hash_equals($SECRET, $receivedSecret),
        "signature_match" => hash_equals($expectedSignature, $receivedSignature),
    ]);

    // Verify secret
    if (empty($receivedSecret)) {
        debug_log("ERROR: No X-Webhook-Secret header");
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Missing X-Webhook-Secret header']);
        exit;
    }

    if (
        !hash_equals($SECRET, $receivedSecret) ||
        !hash_equals($expectedSignature, $receivedSignature)
    ) {
        debug_log("ERROR: Webhook authentication failed");
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Webhook authentication failed']);
        exit;
    }

    if (($parsed['action'] ?? null) === 'clear') {
        @unlink($LOG_FILE);
        file_put_contents($LOG_FILE, json_encode([], JSON_PRETTY_PRINT), LOCK_EX);
        echo json_encode(['success' => true]);
        exit;
    }
    if (($parsed['action'] ?? null) === 'clear_debug') {
        @unlink($ERROR_LOG_FILE);
        echo json_encode(['success' => true]);
        exit;
    }

    // Parse webhook data
    $data = $parsed;
    
    if (!isset($data['event'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing event field']);
        exit;
    }

    // Read existing logs
    $logs = json_decode((string)@file_get_contents($LOG_FILE), true) ?: [];

    // Add new event
    $logs[] = [
        'time' => date('Y-m-d H:i:s'),
        'data' => $data
    ];

    // Keep only last 100 events
    $logs = array_slice($logs, -100);

    // Save logs
    $success = file_put_contents(
        $LOG_FILE,
        json_encode($logs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );

    if (!$success) {
        debug_log("ERROR: Failed to write webhook log");
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Save failed']);
        exit;
    }

    debug_log("SUCCESS: Event logged", ["event" => $data['event']]);

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'message' => 'Webhook logged successfully',
        'event' => $data['event']
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
