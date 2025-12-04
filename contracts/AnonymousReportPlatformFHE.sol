// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AnonymousReportPlatformFHE is SepoliaConfig {
    struct EncryptedReport {
        uint256 id;
        euint32 encryptedTitle;   // Encrypted title
        euint32 encryptedContent; // Encrypted content
        euint32 encryptedCategory; // Encrypted category
        uint256 timestamp;
    }
    
    // Decrypted report details (after reveal)
    struct DecryptedReport {
        string title;
        string content;
        string category;
        bool isRevealed;
    }

    // Contract state
    uint256 public reportCount;
    mapping(uint256 => EncryptedReport) public encryptedReports;
    mapping(uint256 => DecryptedReport) public decryptedReports;
    
    // Encrypted category counters
    mapping(string => euint32) private encryptedCategoryCount;
    string[] private categoryList;
    
    // Decryption requests tracking
    mapping(uint256 => uint256) private requestToReportId;
    
    // Events
    event ReportSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event ReportDecrypted(uint256 indexed id);
    
    modifier onlyReporter(uint256 reportId) {
        // In real implementation, add access control logic
        // For example: require(msg.sender == reporterOf[reportId], "Not reporter");
        _;
    }
    
    /// @notice Submit a new encrypted report
    function submitEncryptedReport(
        euint32 encryptedTitle,
        euint32 encryptedContent,
        euint32 encryptedCategory
    ) public {
        reportCount += 1;
        uint256 newId = reportCount;
        
        encryptedReports[newId] = EncryptedReport({
            id: newId,
            encryptedTitle: encryptedTitle,
            encryptedContent: encryptedContent,
            encryptedCategory: encryptedCategory,
            timestamp: block.timestamp
        });
        
        // Initialize decrypted state
        decryptedReports[newId] = DecryptedReport({
            title: "",
            content: "",
            category: "",
            isRevealed: false
        });
        
        emit ReportSubmitted(newId, block.timestamp);
    }
    
    /// @notice Request decryption of a report
    function requestReportDecryption(uint256 reportId) public onlyReporter(reportId) {
        EncryptedReport storage report = encryptedReports[reportId];
        require(!decryptedReports[reportId].isRevealed, "Already decrypted");
        
        // Prepare encrypted data for decryption
        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(report.encryptedTitle);
        ciphertexts[1] = FHE.toBytes32(report.encryptedContent);
        ciphertexts[2] = FHE.toBytes32(report.encryptedCategory);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptReport.selector);
        requestToReportId[reqId] = reportId;
        
        emit DecryptionRequested(reportId);
    }
    
    /// @notice Callback for decrypted report data
    function decryptReport(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reportId = requestToReportId[requestId];
        require(reportId != 0, "Invalid request");
        
        EncryptedReport storage eReport = encryptedReports[reportId];
        DecryptedReport storage dReport = decryptedReports[reportId];
        require(!dReport.isRevealed, "Already decrypted");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dReport.title = results[0];
        dReport.content = results[1];
        dReport.category = results[2];
        dReport.isRevealed = true;
        
        // Update category count
        if (FHE.isInitialized(encryptedCategoryCount[dReport.category]) == false) {
            encryptedCategoryCount[dReport.category] = FHE.asEuint32(0);
            categoryList.push(dReport.category);
        }
        encryptedCategoryCount[dReport.category] = FHE.add(
            encryptedCategoryCount[dReport.category], 
            FHE.asEuint32(1)
        );
        
        emit ReportDecrypted(reportId);
    }
    
    /// @notice Get decrypted report details
    function getDecryptedReport(uint256 reportId) public view returns (
        string memory title,
        string memory content,
        string memory category,
        bool isRevealed
    ) {
        DecryptedReport storage r = decryptedReports[reportId];
        return (r.title, r.content, r.category, r.isRevealed);
    }
    
    /// @notice Get encrypted category count
    function getEncryptedCategoryCount(string memory category) public view returns (euint32) {
        return encryptedCategoryCount[category];
    }
    
    /// @notice Request category count decryption
    function requestCategoryCountDecryption(string memory category) public {
        euint32 count = encryptedCategoryCount[category];
        require(FHE.isInitialized(count), "Category not found");
        
        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptCategoryCount.selector);
        requestToReportId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(category)));
    }
    
    /// @notice Callback for decrypted category count
    function decryptCategoryCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 categoryHash = requestToReportId[requestId];
        string memory category = getCategoryFromHash(categoryHash);
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted count (could be stored or emitted)
        uint32 count = abi.decode(cleartexts, (uint32));
        // Handle decrypted count as needed
    }
    
    // Helper functions
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getCategoryFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < categoryList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(categoryList[i]))) == hash) {
                return categoryList[i];
            }
        }
        revert("Category not found");
    }
}
