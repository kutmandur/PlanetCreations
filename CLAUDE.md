# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlanetCreations Desktop Client - A hybrid React/Electron application for managing game creations from Planet Coaster 2 and Planet Zoo. Features both online (Firebase-backed community features) and offline (local file management, backups) modes.

## Tech Stack

- **Frontend**: React 18, React Router (HashRouter), TanStack React Query, Tailwind CSS
- **Desktop**: Electron 31, electron-builder, electron-updater
- **Backend**: Firebase (Firestore, Auth, Cloud Functions), Express.js, DigitalOcean Spaces (S3)
- **Discord Integration**: discord.js for bot and OAuth

## Development Commands

```bash
# React development server (localhost:3000)
npm start

# Electron development (React + Electron concurrent)
npm run electron-dev

# Production build
npm run build

# Package desktop app
npm run package

# Tests
npm run test
```

### Firebase Functions (from functions/ directory)

```bash
npm run lint          # ESLint
npm run serve         # Local emulator
npm run deploy        # Deploy to Firebase
npm run logs          # View function logs
```

## Architecture

### Hybrid Online/Offline Mode

- **Online routes** (`/` prefix): Community features, creation sharing, events - requires Firebase
- **Offline routes** (`/client/*` prefix): Local file scanning, backup management - Electron-only, no Firebase required

### Key Directories

- `src/components/pages/` - 20+ route pages
- `src/firebase/` - Firebase service abstractions (community.js, creationsService.js, event.js, database.js)
- `electron/modules/` - Node.js backend modules:
  - `BackupManager.js` - Backup creation/restore with HMAC SHA-256 signing
  - `FileHandler.js` - Game file scanning
  - `MediaManager.js` - Media snapshot management
- `functions/` - Firebase Cloud Functions (Express API)
- `discord-bot/` - Separate Discord bot module

### Electron IPC Architecture

- **Context isolation enabled** - Secure preload.js bridge
- **preload.js** - Exposes 25+ handlers via `window.electron`
- **main.js** - IPC handler implementations
- Handlers include: file selection, game detection, backup lifecycle, updates, protocol handling

### Backup System

- Format: `.PlanetCreations` (ZIP with metadata.json and signature)
- Supported files: .park2, .zoo, .blpr2, .pzblueprint, .prkauto2, .zooauto
- Categories: Parks, Blueprints, Auto Save, Workshop, Custom Media
- Integrity verification via HMAC SHA-256 signing (Firebase function `/signBackup`)

### Protocol Handler

- Custom `planetcreations://` scheme for deep linking
- Auto-import: `planetcreations://?url=<download-url>`
- File association: Double-click .PlanetCreations files triggers import

## Firebase Configuration

Project ID: `planetcreationsdotnet`

Required environment variables (see .env.example):
- REACT_APP_FIREBASE_* variables for React
- Firebase Functions use service account credentials

## Build Configuration

- **App ID**: com.planetcreations.app
- **Targets**: Windows (NSIS), macOS (DMG)
- **Auto-update**: GitHub releases via electron-updater
- **File associations**: .PlanetCreations backup files

## Data Models

- **profiles** - User data, linked to Firebase Auth UID
- **communities** - Groups with members, rules, roles
- **events** - Community events with submissions and galleries
- **creations** - Game files with metadata, backups, media
