import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SupplyChainItem {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  location: string;
  status: string;
}

interface SupplyChainStats {
  totalItems: number;
  verifiedItems: number;
  inTransit: number;
  delivered: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [supplyChainItems, setSupplyChainItems] = useState<SupplyChainItem[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newItemData, setNewItemData] = useState({ 
    name: "", 
    value: "", 
    description: "",
    location: "",
    status: "manufactured"
  });
  const [selectedItem, setSelectedItem] = useState<SupplyChainItem | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadSupplyChainData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadSupplyChainData = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const itemsList: SupplyChainItem[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          itemsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            location: "Warehouse A",
            status: "in_transit"
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSupplyChainItems(itemsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createSupplyChainItem = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingItem(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating supply chain item with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const itemValue = parseInt(newItemData.value) || 0;
      const businessId = `item-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, itemValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newItemData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newItemData.status === "manufactured" ? 1 : 
        newItemData.status === "in_transit" ? 2 : 3,
        0,
        newItemData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Supply chain item created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadSupplyChainData();
      setShowCreateModal(false);
      setNewItemData({ name: "", value: "", description: "", location: "", status: "manufactured" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingItem(false); 
    }
  };

  const decryptItemData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadSupplyChainData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadSupplyChainData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and responsive!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract test failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getSupplyChainStats = (): SupplyChainStats => {
    const totalItems = supplyChainItems.length;
    const verifiedItems = supplyChainItems.filter(item => item.isVerified).length;
    const inTransit = supplyChainItems.filter(item => item.publicValue1 === 2).length;
    const delivered = supplyChainItems.filter(item => item.publicValue1 === 3).length;
    
    return { totalItems, verifiedItems, inTransit, delivered };
  };

  const filteredItems = supplyChainItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || 
                         (filterStatus === "verified" && item.isVerified) ||
                         (filterStatus === "unverified" && !item.isVerified);
    return matchesSearch && matchesFilter;
  });

  const statusLabels: { [key: number]: string } = {
    1: "Manufactured",
    2: "In Transit", 
    3: "Delivered"
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="gear-logo">⚙️</div>
            <h1>SupplyProv FHE</h1>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="connection-prompt">
          <div className="industrial-panel">
            <h2>🔐 Supply Chain Privacy Provenance</h2>
            <p>Connect your wallet to access encrypted supply chain tracking with FHE technology</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <h3>Encrypted Tracking</h3>
                <p>Sensitive data protected with FHE encryption</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <h3>Real-time Verification</h3>
                <p>Verify authenticity without exposing business secrets</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🌐</div>
                <h3>Multi-party Collaboration</h3>
                <p>Secure data sharing across supply chain partners</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="industrial-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing supply chain data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="industrial-spinner"></div>
      <p>Loading Supply Chain System...</p>
    </div>
  );

  const stats = getSupplyChainStats();

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="gear-logo">⚙️</div>
          <h1>SupplyProv FHE</h1>
          <span className="tagline">Industrial-Grade Supply Chain Privacy</span>
        </div>
        
        <nav className="main-nav">
          <button className="nav-btn" onClick={() => setShowFAQ(false)}>Dashboard</button>
          <button className="nav-btn" onClick={() => setShowFAQ(true)}>FAQ</button>
          <button className="test-btn" onClick={testContractAvailability}>Test Contract</button>
        </nav>
        
        <div className="header-actions">
          <button className="create-btn" onClick={() => setShowCreateModal(true)}>
            + New Item
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      {showFAQ ? (
        <div className="faq-section">
          <div className="industrial-panel">
            <h2>FHE Supply Chain FAQ</h2>
            <div className="faq-grid">
              <div className="faq-item">
                <h3>What is FHE in supply chain?</h3>
                <p>Fully Homomorphic Encryption allows computation on encrypted data without decryption, protecting sensitive business information while enabling verification.</p>
              </div>
              <div className="faq-item">
                <h3>How does verification work?</h3>
                <p>Consumers can verify product authenticity through encrypted proofs without accessing proprietary supply chain data.</p>
              </div>
              <div className="faq-item">
                <h3>What data is encrypted?</h3>
                <p>Sensitive numeric values like batch numbers, quality scores, and proprietary metrics are FHE-encrypted.</p>
              </div>
              <div className="faq-item">
                <h3>Is the system secure?</h3>
                <p>Yes, FHE ensures data remains encrypted during processing, providing mathematical security guarantees.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <main className="main-content">
          <div className="stats-panels">
            <div className="stat-panel metal">
              <h3>Total Items</h3>
              <div className="stat-value">{stats.totalItems}</div>
              <div className="stat-label">Tracked</div>
            </div>
            <div className="stat-panel metal">
              <h3>Verified</h3>
              <div className="stat-value">{stats.verifiedItems}</div>
              <div className="stat-label">FHE Secured</div>
            </div>
            <div className="stat-panel metal">
              <h3>In Transit</h3>
              <div className="stat-value">{stats.inTransit}</div>
              <div className="stat-label">Active</div>
            </div>
            <div className="stat-panel metal">
              <h3>Delivered</h3>
              <div className="stat-value">{stats.delivered}</div>
              <div className="stat-label">Completed</div>
            </div>
          </div>

          <div className="controls-section">
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search items..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="industrial-input"
              />
            </div>
            <div className="filter-buttons">
              <button 
                className={`filter-btn ${filterStatus === "all" ? "active" : ""}`}
                onClick={() => setFilterStatus("all")}
              >
                All
              </button>
              <button 
                className={`filter-btn ${filterStatus === "verified" ? "active" : ""}`}
                onClick={() => setFilterStatus("verified")}
              >
                Verified
              </button>
              <button 
                className={`filter-btn ${filterStatus === "unverified" ? "active" : ""}`}
                onClick={() => setFilterStatus("unverified")}
              >
                Unverified
              </button>
            </div>
          </div>

          <div className="items-grid">
            {filteredItems.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <h3>No supply chain items found</h3>
                <p>Create your first encrypted supply chain item to get started</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Create First Item
                </button>
              </div>
            ) : (
              filteredItems.map((item, index) => (
                <div 
                  key={index} 
                  className={`item-card ${item.isVerified ? "verified" : ""}`}
                  onClick={() => setSelectedItem(item)}
                >
                  <div className="card-header">
                    <h3>{item.name}</h3>
                    <span className={`status-badge status-${item.publicValue1}`}>
                      {statusLabels[item.publicValue1] || "Unknown"}
                    </span>
                  </div>
                  <div className="card-content">
                    <p>{item.description}</p>
                    <div className="item-meta">
                      <span>Created: {new Date(item.timestamp * 1000).toLocaleDateString()}</span>
                      <span>By: {item.creator.substring(0, 8)}...</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    <div className={`verification-status ${item.isVerified ? "verified" : "pending"}`}>
                      {item.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </div>
                    {item.isVerified && (
                      <div className="decrypted-value">
                        Value: {item.decryptedValue}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      )}

      {showCreateModal && (
        <CreateItemModal 
          onSubmit={createSupplyChainItem} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingItem} 
          itemData={newItemData} 
          setItemData={setNewItemData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedItem && (
        <ItemDetailModal 
          item={selectedItem} 
          onClose={() => setSelectedItem(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptItemData(selectedItem.id)}
          statusLabels={statusLabels}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="industrial-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateItemModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  itemData: any;
  setItemData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, itemData, setItemData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setItemData({ ...itemData, [name]: intValue });
    } else {
      setItemData({ ...itemData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="industrial-modal">
        <div className="modal-header">
          <h2>Create Supply Chain Item</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Item value will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Item Name *</label>
              <input 
                type="text" 
                name="name" 
                value={itemData.name} 
                onChange={handleChange} 
                className="industrial-input"
                placeholder="Enter item name..."
              />
            </div>
            
            <div className="form-group">
              <label>Encrypted Value (Integer) *</label>
              <input 
                type="number" 
                name="value" 
                value={itemData.value} 
                onChange={handleChange} 
                className="industrial-input"
                placeholder="Enter numeric value..."
                step="1"
                min="0"
              />
              <div className="input-hint">FHE Encrypted Integer</div>
            </div>
            
            <div className="form-group">
              <label>Status *</label>
              <select 
                name="status" 
                value={itemData.status} 
                onChange={handleChange}
                className="industrial-input"
              >
                <option value="manufactured">Manufactured</option>
                <option value="in_transit">In Transit</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description" 
                value={itemData.description} 
                onChange={handleChange}
                className="industrial-input"
                placeholder="Enter item description..."
                rows={3}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !itemData.name || !itemData.value} 
            className="btn-primary"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Item"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ItemDetailModal: React.FC<{
  item: SupplyChainItem;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  statusLabels: { [key: number]: string };
}> = ({ item, onClose, isDecrypting, decryptData, statusLabels }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="industrial-modal large">
        <div className="modal-header">
          <h2>Supply Chain Item Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-section">
              <h3>Basic Information</h3>
              <div className="info-row">
                <span>Name:</span>
                <strong>{item.name}</strong>
              </div>
              <div className="info-row">
                <span>Status:</span>
                <span className={`status-badge status-${item.publicValue1}`}>
                  {statusLabels[item.publicValue1] || "Unknown"}
                </span>
              </div>
              <div className="info-row">
                <span>Description:</span>
                <p>{item.description}</p>
              </div>
            </div>
            
            <div className="detail-section">
              <h3>Encryption Status</h3>
              <div className="encryption-status">
                <div className={`status-indicator ${item.isVerified ? "verified" : "encrypted"}`}>
                  {item.isVerified ? "✅ On-chain Verified" : "🔒 FHE Encrypted"}
                </div>
                
                <div className="data-value">
                  {item.isVerified ? (
                    <div className="decrypted-display">
                      <strong>Decrypted Value:</strong> {item.decryptedValue}
                    </div>
                  ) : (
                    <div className="encrypted-display">
                      <strong>Value Status:</strong> Encrypted with FHE
                    </div>
                  )}
                </div>
                
                <button 
                  className={`decrypt-btn ${item.isVerified ? "verified" : ""}`}
                  onClick={handleDecrypt}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   item.isVerified ? "Already Verified" : "Verify Decryption"}
                </button>
              </div>
            </div>
            
            <div className="detail-section">
              <h3>Metadata</h3>
              <div className="info-row">
                <span>Creator:</span>
                <code>{item.creator}</code>
              </div>
              <div className="info-row">
                <span>Created:</span>
                <span>{new Date(item.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="info-row">
                <span>Item ID:</span>
                <code>{item.id}</code>
              </div>
            </div>
            
            <div className="detail-section">
              <h3>FHE Information</h3>
              <div className="fhe-explanation">
                <p>This item uses Fully Homomorphic Encryption to protect sensitive supply chain data while allowing verification operations.</p>
                <div className="fhe-features">
                  <div className="fhe-feature">
                    <span className="feature-icon">🔐</span>
                    <span>Data remains encrypted during processing</span>
                  </div>
                  <div className="fhe-feature">
                    <span className="feature-icon">✓</span>
                    <span>Verification without decryption</span>
                  </div>
                  <div className="fhe-feature">
                    <span className="feature-icon">⚡</span>
                    <span>Zero-knowledge proofs</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Close</button>
          {!item.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="btn-primary"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

