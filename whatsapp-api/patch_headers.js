import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.join(__dirname, 'views');

const fontLink = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">';
const fontRegex = /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter.*?rel="stylesheet">/g;

const dashboardNav = `    <!-- Navigation -->
    <nav class="fixed top-0 w-full z-50 glass-panel border-b border-gray-800">
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
                    <a href="/sessions" class="text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-server mr-1 hidden lg:inline"></i> Dashboard</a>
                    <a href="/subscriptions" class="text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-gem mr-1 hidden lg:inline"></i> Subscribe</a>
                    <a href="/recharge" class="text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium"><i class="fas fa-wallet mr-1 hidden lg:inline"></i> Wallet</a>
                    <a href="/doc" class="text-gray-400 hover:text-emerald-400 transition-colors text-sm font-medium hidden md:block"><i class="fas fa-code mr-1"></i> API Docs</a>
                    <!-- User Preview Pill on the Nav Bar directly -->
                    <div class="flex items-center gap-2 bg-gray-800/80 border border-gray-700/80 px-4 py-1.5 rounded-full cursor-pointer hover:bg-gray-700 transition" onclick="window.location.href='/profile'">
                        <div class="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-xs font-bold text-white"><i class="fas fa-user text-xs"></i></div>
                        <span class="text-sm font-semibold text-gray-200 hidden md:block">Profile</span>
                    </div>
                    <button onclick="window.location.href='/api/auth/logout'" class="text-rose-400 hover:text-white hover:bg-rose-500 transition-colors text-sm font-medium px-3 py-1.5 rounded-full border border-rose-500/20"><i class="fas fa-sign-out-alt"></i></button>
                </div>
            </div>
        </div>
    </nav>`;

const dashboardFiles = ['sessions.html', 'profile.html', 'recharge.html', 'subscriptions.html'];

for (const file of fs.readdirSync(viewsDir)) {
    if (!file.endsWith('.html')) continue;
    let content = fs.readFileSync(path.join(viewsDir, file), 'utf8');
    
    // 1. Unify Font Link
    content = content.replace(fontRegex, fontLink);
    
    // 2. Unify .glass-panel class properly globally in css
    content = content.replace(/\.glass-nav \{/g, '.glass-panel {');
    content = content.replace(/class="([^"]*)glass-nav([^"]*)"/g, 'class="$1glass-panel$2"');
    
    // 3. For Dashboard Files, completely replace <nav>
    if (dashboardFiles.includes(file)) {
        content = content.replace(/<!-- Navigation -->[\s\S]*?<\/nav>/, dashboardNav);
    }
    
    // 4. Special case for sessions.html - Move the 'New Device' button from nav to the header area if not already
    if (file === 'sessions.html') {
        const h1Regex = /(<h1 class="text-3xl font-bold text-white mb-2 tracking-tight">Devices & Sessions<\/h1>\s*<p class="text-gray-400 text-sm">Monitor and control your WhatsApp connections\.<\/p>\s*<\/div>)/;
        if (!content.includes('id="newDeviceHeaderBtn"')) {
            content = content.replace(h1Regex, `$1
            <div>
                <button id="newDeviceHeaderBtn" onclick="createSession()" class="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-5 py-2.5 rounded-full text-sm font-bold hover:from-emerald-400 hover:to-green-500 transition-all shadow-lg shadow-emerald-500/25 border border-emerald-400 flex items-center gap-2">
                    <i class="fas fa-plus"></i> New Device
                </button>
            </div>`);
        }
    }
    
    fs.writeFileSync(path.join(viewsDir, file), content, 'utf8');
}

console.log('Successfully patched all fonts and navbars!');
