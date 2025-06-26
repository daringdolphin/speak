# Code Signing Setup for QuickTranscriber

This directory contains documentation and configuration for code signing the QuickTranscriber application for distribution.

## Overview

Code signing is required for:
- **Windows SmartScreen** bypass - Prevents "Unknown publisher" warnings
- **Windows Defender** trust - Reduces false positive detections  
- **Enterprise deployment** - Many organizations require signed applications
- **Auto-updater** - Signed updates provide security verification

## Windows Code Signing (Required for Distribution)

### Certificate Requirements

You need a **Code Signing Certificate** from a trusted Certificate Authority (CA):

**Recommended CAs:**
- **DigiCert** - Industry standard, $474/year
- **Sectigo (formerly Comodo)** - Budget option, $199/year  
- **GlobalSign** - Enterprise focused, $249/year
- **SSL.com** - Budget option with EV available, $159/year

**Certificate Types:**
- **Standard Code Signing** - Basic signing, shows warning initially
- **EV Code Signing** - Extended Validation, immediate trust (recommended)

### Setup Instructions

#### 1. Obtain Certificate

1. Purchase code signing certificate from CA
2. Complete identity verification process (1-5 business days)
3. Download certificate as `.p12` or `.pfx` file

#### 2. Install Certificate

**Option A: Install to Windows Certificate Store (Recommended)**
```bash
# Double-click the .pfx file and follow the wizard
# Choose "Local Machine" store
# Import to "Personal" certificate store
# Set a strong password
```

**Option B: Use Certificate File Directly**
```bash
# Place certificate file in this directory
cp your-cert.pfx ./cert.pfx
```

#### 3. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# For certificate in Windows store:
CSC_LINK=<Certificate Common Name or Thumbprint>

# For certificate file:
CSC_LINK=./certs/cert.pfx
CSC_KEY_PASSWORD=your_certificate_password

# Optional: Timestamp server (recommended)
CSC_TIMESTAMP_URL=http://timestamp.digicert.com
```

**Finding Certificate Thumbprint:**
```powershell
# Open PowerShell as Administrator
Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object {$_.Subject -like "*YourCompanyName*"}
```

#### 4. Update electron-builder Configuration

The `electron-builder.json` file should include:

```json
{
  "win": {
    "certificateFile": "certs/cert.pfx",
    "certificatePassword": null,
    "publisherName": "Your Company Name",
    "verifyUpdateCodeSignature": true
  },
  "nsis": {
    "differentialPackage": false
  }
}
```

#### 5. Build Signed Application

```bash
# Build and sign the application
pnpm build

# Verify signing (optional)
signtool verify /pa dist/QuickTranscriber-Setup-*.exe
```

## Security Best Practices

### Certificate Storage

**✅ Recommended:**
- Use Windows Certificate Store for local development
- Use Azure Key Vault or AWS CloudHSM for CI/CD
- Hardware Security Module (HSM) for maximum security

**❌ Avoid:**
- Storing certificate files in version control
- Using weak passwords
- Sharing certificates between developers

### CI/CD Integration

For automated builds (GitHub Actions):

```yaml
- name: Import Code Signing Certificate
  run: |
    echo "${{ secrets.CSC_LINK }}" | base64 --decode > cert.pfx
    
- name: Build and Sign
  env:
    CSC_LINK: cert.pfx
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  run: pnpm build
```

### Certificate Validation

Always verify your signed executable:

```bash
# Windows: Check signature
signtool verify /pa /v "dist/QuickTranscriber-Setup-*.exe"

# PowerShell: Detailed certificate info  
Get-AuthenticodeSignature "dist/QuickTranscriber-Setup-*.exe" | Format-List
```

## Troubleshooting

### Common Issues

**"SignTool Error: No certificates were found that met all the given criteria"**
- Certificate not installed in correct store
- Wrong certificate name/thumbprint
- Certificate expired

**"The specified timestamp server either could not be reached or returned an invalid response"**
- Try different timestamp server
- Check internet connection
- Temporarily disable timestamp for testing

**"Access denied" during signing**
- Run build as Administrator
- Check certificate permissions
- Verify CSC_KEY_PASSWORD is correct

### Timestamp Servers (Fallback Options)

If DigiCert timestamp fails, try these alternatives:

```bash
# Sectigo/Comodo
http://timestamp.sectigo.com

# GlobalSign  
http://timestamp.globalsign.com/scripts/timstamp.dll

# Microsoft (for Authenticode)
http://timestamp.verisign.com/scripts/timstamp.dll
```

## Cost Considerations

### Annual Certificate Costs

| Provider | Standard | EV Code Signing |
|----------|----------|-----------------|
| DigiCert | $474/year | $895/year |
| Sectigo | $199/year | $499/year |
| SSL.com | $159/year | $399/year |
| GlobalSign | $249/year | $599/year |

### ROI Benefits

- **Reduced support tickets** - Fewer "unsafe software" reports
- **Higher conversion rates** - Users more likely to install
- **Enterprise sales** - Many require signed software
- **Brand reputation** - Professional appearance

## Testing

### Pre-Release Validation

1. **SmartScreen Test**: Install on clean Windows VM
2. **Defender Test**: Scan with Windows Defender
3. **Enterprise Test**: Test in domain environment
4. **Auto-update Test**: Verify update signature validation

### Monitoring

Track installation success rates:
- Monitor telemetry for installation failures
- Check Windows Event Logs for SmartScreen blocks
- Survey users about security warnings

## Renewal Process

**60 Days Before Expiration:**
1. Purchase renewed certificate
2. Update CI/CD secrets  
3. Test signing process
4. Schedule deployment window

**Certificate Management:**
- Set calendar reminders for renewal
- Monitor certificate expiration in builds
- Keep backup certificates for emergency use

## Support

For issues with this setup:
1. Check the [electron-builder docs](https://www.electron.build/code-signing)
2. Review Windows Event Logs
3. Contact your Certificate Authority for certificate issues
4. Open GitHub issue with sanitized error logs

---

**Security Note:** Never commit certificate files or passwords to version control. Use environment variables and secure secret management. 