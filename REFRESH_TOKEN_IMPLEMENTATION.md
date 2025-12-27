# Refresh Token Implementation

## Overview
This implementation fixes the refresh token flow to ensure users stay signed in automatically when their access tokens expire, instead of being logged out.

## Changes Made

### 1. Database Schema Updates
- **File**: `prisma/schema.prisma`
- **Changes**: Added `RefreshToken` model with proper relationships
- **Fields**:
  - `id`: Unique identifier (cuid)
  - `token`: The refresh token value (hex string)
  - `userId`: Foreign key to user table
  - `expiresAt`: Token expiration timestamp
  - `createdAt`: Creation timestamp
  - `isRevoked`: Boolean flag for token revocation

### 2. Backend Service Updates

#### Auth Service (`src/auth/auth.service.ts`)
- **Token Storage**: Refresh tokens are now stored in database instead of being stateless JWTs
- **Token Rotation**: Each refresh generates new access and refresh tokens
- **Token Revocation**: Old refresh tokens are revoked when new ones are issued
- **Security**: Uses cryptographically secure random tokens (32 bytes hex)

#### Auth Controller (`src/auth/auth.controller.ts`)
- **New Endpoint**: Added `POST /auth/refresh` for dedicated token refresh
- **Existing Endpoint**: Enhanced `POST /auth/verify` to handle token refresh

#### Auth Guard (`src/auth/auth.guard.ts`)
- **Automatic Refresh**: Automatically attempts refresh when access token is expired
- **Header Injection**: Sets new tokens in response headers for frontend consumption
- **Error Handling**: Proper error handling for token refresh failures

### 3. Frontend Updates

#### API Layer (`api/index.ts`)
- **Automatic Refresh**: Added `makeAuthenticatedRequest` function with automatic token refresh
- **Retry Logic**: Automatically retries failed requests after token refresh
- **Token Management**: Seamless token storage and retrieval

#### Auth Provider (`providers/AuthProvider.tsx`)
- **Enhanced Verification**: Improved token verification with automatic refresh
- **Token Updates**: Automatically updates stored tokens when refresh occurs
- **Error Handling**: Better error handling for authentication failures

#### Signin API (`api/signin.ts`)
- **Refresh Endpoint**: Added proper refresh token API call

## Key Features

### 1. Token Rotation
- Each refresh generates completely new tokens
- Old refresh tokens are immediately revoked
- Prevents token reuse attacks

### 2. Database Storage
- Refresh tokens are stored in database with expiration
- Enables token revocation and tracking
- Provides audit trail for security

### 3. Automatic Refresh
- Frontend automatically refreshes tokens on API calls
- Backend automatically refreshes tokens in auth guard
- Seamless user experience

### 4. Security Enhancements
- Cryptographically secure token generation
- Token expiration tracking
- Immediate token revocation
- Protection against token replay attacks

## Setup Instructions

### 1. Database Migration
```bash
# Option 1: Use Prisma (if permissions allow)
cd zenlot-server
npx prisma migrate dev --name add_refresh_tokens
npx prisma generate

# Option 2: Manual SQL (if Prisma fails due to permissions)
# Run the SQL script in scripts/migrate-refresh-tokens.sql
```

### 2. Environment Variables
Ensure these are set in your `.env` file:
```env
JWT_SECRET=your_jwt_secret
JWT_EXPIRES=3600s
JWT_REFRESH_SECRET=your_refresh_secret
JWT_REFRESH_EXPIRES=7d
```

### 3. Restart Services
```bash
# Restart backend
cd zenlot-server
npm run start:dev

# Restart frontend
cd zenlot
npm start
```

## API Endpoints

### New Endpoints
- `POST /auth/refresh` - Refresh access token using refresh token

### Enhanced Endpoints
- `POST /auth/verify` - Now handles automatic token refresh
- `POST /auth/signin` - Now stores refresh tokens in database
- `POST /auth/signup` - Now stores refresh tokens in database

## Testing

### Test Scenarios
1. **Normal Login**: User logs in, receives both access and refresh tokens
2. **Token Expiry**: Access token expires, refresh token automatically generates new tokens
3. **Refresh Expiry**: Both tokens expire, user must re-authenticate
4. **Token Revocation**: User logs out, all refresh tokens are revoked
5. **Multiple Devices**: Each login creates new refresh tokens, old ones remain valid until expiry

### Manual Testing
```bash
# Test login
curl -X POST http://localhost:3000/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Test token refresh
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"your_refresh_token"}'

# Test protected endpoint with expired access token
curl -X GET http://localhost:3000/protected-endpoint \
  -H "access_token:expired_token" \
  -H "refresh_access_token:valid_refresh_token"
```

## Security Considerations

### 1. Token Storage
- Refresh tokens are stored securely in database
- Access tokens remain stateless JWTs
- Proper expiration handling

### 2. Token Rotation
- Each refresh generates new tokens
- Old tokens are immediately revoked
- Prevents token reuse

### 3. Error Handling
- Proper error responses for invalid tokens
- Graceful fallback to re-authentication
- No sensitive information in error messages

## Troubleshooting

### Common Issues
1. **"RefreshToken model not yet available"**: Run `npx prisma generate`
2. **Permission denied on migration**: Use manual SQL script
3. **Tokens not refreshing**: Check environment variables
4. **Frontend not updating tokens**: Check API interceptor implementation

### Debug Mode
Enable debug logging by setting `LOG_LEVEL=debug` in environment variables.

## Migration Notes

### Backward Compatibility
- Existing access tokens continue to work until expiry
- No immediate impact on current users
- Gradual migration as users refresh their sessions

### Performance Impact
- Minimal performance impact
- Database queries only during token refresh
- Cached token validation where possible
