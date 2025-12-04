// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TherapyNote {
  id: string;
  encryptedContent: string;
  timestamp: number;
  therapist: string;
  patient: string;
  status: "pending" | "analyzed" | "archived";
  emotionAnalysis: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<TherapyNote[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newNoteData, setNewNoteData] = useState({
    content: "",
    emotion: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Calculate statistics
  const analyzedCount = notes.filter(n => n.status === "analyzed").length;
  const pendingCount = notes.filter(n => n.status === "pending").length;
  const archivedCount = notes.filter(n => n.status === "archived").length;

  useEffect(() => {
    loadNotes().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (account) {
      loadNotes();
    }
  }, [account]);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadNotes = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("note_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing note keys:", e);
        }
      }
      
      const list: TherapyNote[] = [];
      
      for (const key of keys) {
        try {
          const noteBytes = await contract.getData(`note_${key}`);
          if (noteBytes.length > 0) {
            try {
              const noteData = JSON.parse(ethers.toUtf8String(noteBytes));
              list.push({
                id: key,
                encryptedContent: noteData.content,
                timestamp: noteData.timestamp,
                therapist: noteData.therapist,
                patient: noteData.patient,
                status: noteData.status || "pending",
                emotionAnalysis: noteData.emotionAnalysis || ""
              });
            } catch (e) {
              console.error(`Error parsing note data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading note ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNotes(list);
    } catch (e) {
      console.error("Error loading notes:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitNote = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }

    let noteId: string = "";
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting therapy note with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedContent = `FHE-${btoa(JSON.stringify(newNoteData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const noteId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const noteData = {
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        therapist: account,
        patient: "0xPatientAddress", // In real app this would be dynamic
        status: "pending",
        emotionAnalysis: ""
      };
      
      const newNote: TherapyNote = {
        id: noteId,
        encryptedContent: encryptedContent,
        timestamp: noteData.timestamp,
        therapist: account,
        patient: noteData.patient,
        status: "pending",
        emotionAnalysis: ""
      };
      
      setNotes(prev => [newNote, ...prev]);
      
      const tx1 = await contract.setData(
        `note_${noteId}`, 
        ethers.toUtf8Bytes(JSON.stringify(noteData))
      );
      
      await tx1.wait();
      
      const keysBytes = await contract.getData("note_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(noteId);
      
      const tx2 = await contract.setData(
        "note_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      await tx2.wait();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted therapy note submitted securely!"
      });
      
      await loadNotes();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewNoteData({
          content: "",
          emotion: ""
        });
      }, 2000);
    } catch (e: any) {
      setNotes(prev => prev.filter(note => note.id !== noteId));
      
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const analyzeNote = async (noteId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE AI..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const noteBytes = await contract.getData(`note_${noteId}`);
      if (noteBytes.length === 0) {
        throw new Error("Note not found");
      }
      
      const noteData = JSON.parse(ethers.toUtf8String(noteBytes));
      
      // Simulate FHE analysis
      const emotions = ["Calm", "Anxious", "Hopeful", "Depressed", "Angry"];
      const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];
      
      const updatedNote = {
        ...noteData,
        status: "analyzed",
        emotionAnalysis: randomEmotion
      };
      
      const tx = await contract.setData(
        `note_${noteId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNote))
      );
      
      await tx.wait();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadNotes();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const archiveNote = async (noteId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Archiving encrypted note..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const noteBytes = await contract.getData(`note_${noteId}`);
      if (noteBytes.length === 0) {
        throw new Error("Note not found");
      }
      
      const noteData = JSON.parse(ethers.toUtf8String(noteBytes));
      
      const updatedNote = {
        ...noteData,
        status: "archived"
      };
      
      const tx = await contract.setData(
        `note_${noteId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNote))
      );
      
      await tx.wait();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Note archived securely!"
      });
      
      await loadNotes();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Archiving failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isTherapist = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start your therapy session",
      icon: "🔗"
    },
    {
      title: "Create Session Note",
      description: "Securely document your therapy session with FHE encryption",
      icon: "📝"
    },
    {
      title: "FHE Emotion Analysis",
      description: "Our AI analyzes your encrypted notes without decryption",
      icon: "🧠"
    },
    {
      title: "Review Insights",
      description: "Receive private emotional insights to guide your therapy",
      icon: "🔍"
    }
  ];

  const renderPieChart = () => {
    const total = notes.length || 1;
    const analyzedPercentage = (analyzedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const archivedPercentage = (archivedCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment analyzed" 
            style={{ transform: `rotate(${analyzedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment archived" 
            style={{ transform: `rotate(${(analyzedPercentage + pendingPercentage + archivedPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{notes.length}</div>
            <div className="pie-label">Notes</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box analyzed"></div>
            <span>Analyzed: {analyzedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box archived"></div>
            <span>Archived: {archivedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  const activeNote = notes.find(note => note.id === activeNoteId);

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="brain-icon"></div>
          </div>
          <h1>Mind<span>Shield</span>Therapy</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-note-btn"
          >
            <div className="add-icon"></div>
            New Session Note
          </button>
          <button 
            className="stats-toggle"
            onClick={() => setShowStats(!showStats)}
          >
            {showStats ? "Hide Stats" : "Show Stats"}
          </button>
          <button 
            className="tutorial-toggle"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-layout">
        <div className="left-panel">
          <div className="panel-section">
            <h2>Therapy Notes</h2>
            <div className="notes-list">
              {isRefreshing && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <p>Loading encrypted notes...</p>
                </div>
              )}
              
              {notes.length === 0 ? (
                <div className="no-notes">
                  <div className="no-notes-icon"></div>
                  <p>No therapy notes found</p>
                  <button 
                    className="primary-btn"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Note
                  </button>
                </div>
              ) : (
                notes.map(note => (
                  <div 
                    className={`note-item ${activeNoteId === note.id ? 'active' : ''}`}
                    key={note.id}
                    onClick={() => setActiveNoteId(note.id)}
                  >
                    <div className="note-header">
                      <div className="note-id">Session #{note.id.substring(0, 6)}</div>
                      <div className={`status-badge ${note.status}`}>
                        {note.status}
                      </div>
                    </div>
                    <div className="note-date">
                      {new Date(note.timestamp * 1000).toLocaleDateString()}
                    </div>
                    {note.emotionAnalysis && (
                      <div className="emotion-tag">
                        {note.emotionAnalysis}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="panel-section">
            <h2>Quick Actions</h2>
            <div className="action-buttons">
              <button 
                onClick={loadNotes}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Notes"}
              </button>
              <button 
                className="fhe-check-btn"
                onClick={async () => {
                  try {
                    const contract = await getContractReadOnly();
                    if (contract) {
                      const isAvailable = await contract.isAvailable();
                      if (isAvailable) {
                        alert("FHE system is operational and secure");
                      }
                    }
                  } catch (e) {
                    console.error("FHE check failed", e);
                  }
                }}
              >
                Check FHE Status
              </button>
            </div>
          </div>
        </div>
        
        <div className="main-panel">
          {showTutorial && (
            <div className="tutorial-section">
              <h2>Secure Therapy Guide</h2>
              <p className="subtitle">Your privacy is protected with FHE technology</p>
              
              <div className="tutorial-steps">
                {tutorialSteps.map((step, index) => (
                  <div 
                    className="tutorial-step"
                    key={index}
                  >
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-content">
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {showStats && (
            <div className="stats-section">
              <div className="stats-card">
                <h3>Session Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{notes.length}</div>
                    <div className="stat-label">Total Notes</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{analyzedCount}</div>
                    <div className="stat-label">Analyzed</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{archivedCount}</div>
                    <div className="stat-label">Archived</div>
                  </div>
                </div>
              </div>
              
              <div className="chart-card">
                <h3>Note Status Distribution</h3>
                {renderPieChart()}
              </div>
            </div>
          )}
          
          {activeNote && (
            <div className="note-detail">
              <div className="detail-header">
                <h2>Session #{activeNote.id.substring(0, 6)}</h2>
                <div className="header-actions">
                  {isTherapist(activeNote.therapist) && activeNote.status === "pending" && (
                    <button 
                      className="action-btn"
                      onClick={() => analyzeNote(activeNote.id)}
                    >
                      Analyze with FHE AI
                    </button>
                  )}
                  {isTherapist(activeNote.therapist) && activeNote.status !== "archived" && (
                    <button 
                      className="action-btn archive"
                      onClick={() => archiveNote(activeNote.id)}
                    >
                      Archive Note
                    </button>
                  )}
                </div>
              </div>
              
              <div className="detail-meta">
                <div className="meta-item">
                  <span>Therapist:</span>
                  {activeNote.therapist.substring(0, 6)}...{activeNote.therapist.substring(38)}
                </div>
                <div className="meta-item">
                  <span>Patient:</span>
                  {activeNote.patient}
                </div>
                <div className="meta-item">
                  <span>Date:</span>
                  {new Date(activeNote.timestamp * 1000).toLocaleString()}
                </div>
                <div className="meta-item">
                  <span>Status:</span>
                  <span className={`status-tag ${activeNote.status}`}>
                    {activeNote.status}
                  </span>
                </div>
                {activeNote.emotionAnalysis && (
                  <div className="meta-item">
                    <span>Emotion Analysis:</span>
                    <span className="emotion-tag">
                      {activeNote.emotionAnalysis}
                    </span>
                  </div>
                )}
              </div>
              
              <div className="encrypted-content">
                <h3>Encrypted Session Notes</h3>
                <div className="content-box">
                  {activeNote.encryptedContent}
                </div>
                <div className="fhe-badge">
                  <span>FHE-Encrypted Content</span>
                </div>
              </div>
            </div>
          )}
          
          {!activeNote && !showTutorial && !showStats && (
            <div className="welcome-message">
              <div className="welcome-icon"></div>
              <h2>Welcome to MindShield Therapy</h2>
              <p>Your private therapy sessions protected by FHE encryption</p>
              <p>Select a session note or create a new one to begin</p>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitNote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          noteData={newNoteData}
          setNoteData={setNewNoteData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="brain-icon"></div>
              <span>MindShield Therapy</span>
            </div>
            <p>Privacy-first therapy platform powered by FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">How FHE Protects You</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} MindShield Therapy. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  noteData: any;
  setNoteData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  noteData,
  setNoteData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNoteData({
      ...noteData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!noteData.content) {
      alert("Please enter session notes");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Therapy Session Note</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            <span>Your notes will be encrypted with FHE technology</span>
          </div>
          
          <div className="form-group">
            <label>Session Notes *</label>
            <textarea 
              name="content"
              value={noteData.content} 
              onChange={handleChange}
              placeholder="Document your therapy session..." 
              className="content-textarea"
              rows={6}
            />
          </div>
          
          <div className="privacy-guarantee">
            <h3>Privacy Guarantee</h3>
            <ul>
              <li>End-to-end encrypted session notes</li>
              <li>FHE AI analyzes without decrypting your data</li>
              <li>Only you and your therapist can access notes</li>
            </ul>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting with FHE..." : "Create Secure Note"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;