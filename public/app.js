const API_URL = '/api/agents';
let agents = [];

// DOM Elements
const agentsList = document.getElementById('agentsList');
const modal = document.getElementById('agentModal');
const form = document.getElementById('agentForm');
const createBtn = document.getElementById('createAgentBtn');
const closeBtn = document.querySelector('.close');
const cancelBtn = document.getElementById('cancelBtn');
const connectionStatus = document.querySelector('.status-dot');
const statusText = document.getElementById('statusText');
const qrContainer = document.getElementById('qrContainer');
const restartBtn = document.getElementById('restartBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchAgents();
    checkStatus();
    setInterval(checkStatus, 5000);
});

// Fetch Agents
async function fetchAgents() {
    try {
        const res = await fetch(API_URL);
        agents = await res.json();
        renderAgents();
    } catch (error) {
        console.error('Error fetching agents:', error);
    }
}

// Render Agents
function renderAgents() {
    agentsList.innerHTML = agents.map(agent => `
        <div class="agent-card ${agent.isDefault ? 'default' : ''}">
            <div class="agent-header">
                <span class="agent-name">${agent.name}</span>
                ${agent.isDefault ? '<span class="agent-badge">Por Defecto</span>' : ''}
            </div>
            <p class="agent-prompt">${agent.systemPrompt}</p>
            <div class="agent-keywords">
                ${agent.keywords.map(k => `<span class="keyword-tag">${k}</span>`).join('')}
            </div>
            <div class="agent-actions">
                <button class="btn-edit" onclick="editAgent('${agent.id}')">✏️ Editar</button>
                ${!agent.isDefault ? `<button class="btn-danger" onclick="deleteAgent('${agent.id}')">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

// Create/Edit Agent
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('agentId').value;
    const agentData = {
        name: document.getElementById('agentName').value,
        systemPrompt: document.getElementById('agentPrompt').value,
        keywords: document.getElementById('agentKeywords').value.split(',').map(k => k.trim()).filter(k => k),
        isDefault: document.getElementById('agentDefault').checked
    };

    try {
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_URL}/${id}` : API_URL;

        await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agentData)
        });

        closeModal();
        fetchAgents();
    } catch (error) {
        console.error('Error saving agent:', error);
    }
});

// Delete Agent
window.deleteAgent = async (id) => {
    if (!confirm('¿Estás seguro de eliminar este agente?')) return;

    try {
        await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        fetchAgents();
    } catch (error) {
        console.error('Error deleting agent:', error);
    }
};

// Edit Agent
window.editAgent = (id) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;

    document.getElementById('agentId').value = agent.id;
    document.getElementById('agentName').value = agent.name;
    document.getElementById('agentPrompt').value = agent.systemPrompt;
    document.getElementById('agentKeywords').value = agent.keywords.join(', ');
    document.getElementById('agentDefault').checked = agent.isDefault;

    document.getElementById('modalTitle').textContent = 'Editar Agente';
    modal.style.display = 'flex';
};

// Modal Handlers
createBtn.onclick = () => {
    form.reset();
    document.getElementById('agentId').value = '';
    document.getElementById('modalTitle').textContent = 'Nuevo Agente';
    modal.style.display = 'flex';
};

closeBtn.onclick = closeModal;
cancelBtn.onclick = closeModal;

function closeModal() {
    modal.style.display = 'none';
}

window.onclick = (e) => {
    if (e.target === modal) closeModal();
};

// Status & QR
async function checkStatus() {
    try {
        const res = await fetch('/status');
        const data = await res.json();

        if (data.connected) {
            connectionStatus.className = 'status-dot online';
            statusText.textContent = 'Conectado';
            qrContainer.innerHTML = '<p>✅ Bot conectado y listo</p>';
        } else {
            connectionStatus.className = 'status-dot offline';
            statusText.textContent = 'Desconectado';

            if (data.hasQR) {
                fetchQR();
            } else {
                qrContainer.innerHTML = '<p>⏳ Esperando código QR...</p>';
            }
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

async function fetchQR() {
    try {
        const res = await fetch('/qr');
        const data = await res.json();

        if (data.success && data.qr) {
            // Generar QR usando una API externa para mostrarlo
            qrContainer.innerHTML = `
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qr)}" 
                     alt="Código QR" class="qr-image">
                <p>Escanea con WhatsApp</p>
            `;
        }
    } catch (error) {
        console.error('Error fetching QR:', error);
    }
}

restartBtn.onclick = async () => {
    try {
        await fetch('/restart');
        alert('Reiniciando conexión...');
        checkStatus();
    } catch (error) {
        console.error('Error restarting:', error);
    }
};
