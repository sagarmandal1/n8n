import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDocPath = path.join(__dirname, 'views', 'api-doc.html');

let content = fs.readFileSync(apiDocPath, 'utf8');

// 1. Inject Tailwind
if (!content.includes('cdn.tailwindcss.com')) {
    content = content.replace('</head>', '  <script src="https://cdn.tailwindcss.com"></script>\n</head>');
}

// 2. Set Fonts
content = content.replace(
    /<link[^>]*family=Inter[^>]*>/,
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">'
);

// 3. Dark Theme Sidebar and Adjust Height for Navbar
content = content.replace(
    /\.sidebar \s*{\s*width: 320px;\s*background-color: white;\s*position: fixed;\s*top: 0;\s*left: 0;\s*height: 100vh;/s,
    `.sidebar {
        width: 320px;
        background-color: #0f172a;
        position: fixed;
        top: 64px;
        left: 0;
        height: calc(100vh - 64px);`
);

// Border color
content = content.replace(/border-right: 1px solid var\(--border-color\);/, 'border-right: 1px solid #1f2937;');

// Sidebar text adjustments (Links should contrast properly)
content = content.replace(/\.nav-link.active\s*{\s*background-color: var\(--primary-light\);\s*color: var\(--primary-dark\);/s, 
`.nav-link.active {
        background-color: rgba(16, 185, 129, 0.1);
        color: var(--primary-color);`);

content = content.replace(/\.nav-link:hover\s*{\s*background-color: var\(--light-gray\);\s*color: var\(--primary-dark\);/s,
`.nav-link:hover {
        background-color: rgba(255, 255, 255, 0.05);
        color: var(--primary-color);`);

content = content.replace(/\.nav-section h3\s*{\s*font-size: 14px;/s,
`.nav-section h3 {
        color: #6b7280;
        font-size: 14px;`);

// Also adjust the logo background and border
content = content.replace(/\.logo-container\s*{\s*padding: 0 25px 25px;\s*border-bottom: 1px solid var\(--border-color\);/s,
`.logo-container {
        padding: 0 25px 25px;
        border-bottom: 1px solid #1f2937;`);

// Reconfigure Main Content margin-top
content = content.replace(/\.content \s*{\s*flex: 1;\s*padding: 30px 40px;\s*margin-left: 320px;\s*transition: margin-left 0.3s ease;\s*}/s,
`.content {
        flex: 1;
        padding: 94px 40px 30px; /* 64px navbar + 30px padding */
        margin-left: 320px;
        transition: margin-left 0.3s ease;
      }`);

// Unified Navbar Definition
const dashboardNav = `
    <!-- Navigation -->
    <nav class="fixed top-0 w-full z-50 bg-[#030712]/70 backdrop-blur-xl border-b border-gray-800" style="backdrop-filter: blur(16px);">
        <div class="max-w-7xl mx-auto px-6 lg:px-8">
            <div class="flex items-center justify-between h-16">
                <!-- Project Logo and Home Link -->
                <div class="flex-shrink-0 flex items-center gap-3 cursor-pointer" onclick="window.location.href='/'">
                    <div class="w-8 h-8 bg-gradient-to-br from-emerald-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                        <i class="fab fa-whatsapp text-white text-lg"></i>
                    </div>
                    <span class="text-lg md:text-xl font-bold tracking-tight text-white hidden sm:block">WaFastApi</span>
                </div>
                <!-- Links properly routed -->
                <div class="flex items-center space-x-4 md:space-x-6">
                    <a href="/sessions" class="hidden md:inline text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-server mr-1 hidden lg:inline"></i> Dashboard</a>
                    <a href="/subscriptions" class="hidden md:inline text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-gem mr-1 hidden lg:inline"></i> Subscribe</a>
                    <a href="/recharge" class="hidden md:inline text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-wallet mr-1 hidden lg:inline"></i> Wallet</a>
                    <a href="/doc" class="text-emerald-400 transition-colors text-sm font-bold"><i class="fas fa-code mr-1"></i> API Docs</a>
                    <!-- User Preview Pill on the Nav Bar directly -->
                    <div class="flex items-center gap-2 bg-gray-800/80 border border-gray-700/80 px-4 py-1.5 rounded-full cursor-pointer hover:bg-gray-700 transition" onclick="window.location.href='/profile'">
                        <div class="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-xs font-bold text-white"><i class="fas fa-user text-xs"></i></div>
                        <span class="text-sm font-semibold text-gray-200 block">Profile</span>
                    </div>
                    <button onclick="window.location.href='/api/auth/logout'" class="text-rose-400 hover:text-white hover:bg-rose-500 transition-colors text-sm font-medium px-3 py-1.5 rounded-full border border-rose-500/20"><i class="fas fa-sign-out-alt"></i></button>
                </div>
            </div>
        </div>
    </nav>
`;

// Inject Navbar right after <body>
if (!content.includes('<!-- Navigation -->')) {
    content = content.replace(/<body[^>]*>/, match => `${match}\n${dashboardNav}`);
}

// Write the file back
fs.writeFileSync(apiDocPath, content, 'utf8');

console.log('Successfully patched API docs!');
