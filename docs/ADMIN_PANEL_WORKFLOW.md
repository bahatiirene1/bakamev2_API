# Admin Panel Development Workflow

## CRITICAL RULES - DO NOT VIOLATE

### Rule 1: Backend is LOCKED
- **The backend is production-ready and MUST NOT be refactored**
- Only ADD new endpoints/functionality when absolutely necessary for admin features
- Never modify existing backend logic, patterns, or structure
- If backend changes are needed, document exactly what was added (not refactored)

### Rule 2: Understand Backend BEFORE Frontend
**Before working on ANY frontend feature, launch 4 agents simultaneously to:**
1. Study the relevant API routes in `src/api/routes/`
2. Study the relevant services in `src/services/`
3. Study the database adapters in `src/adapters/`
4. Study the types in `src/types/`

Only after having a FULL picture of how the backend handles that feature, proceed with frontend implementation.

### Rule 3: Real Database Testing ONLY
- **NO mockups, NO kumbaya tests**
- All features must work with REAL Supabase database
- Insert test data in database when needed to verify features
- Verify data displays correctly by checking actual database counts

### Rule 4: User Verification Loop
After each phase is built:
1. Build succeeds (no TypeScript errors)
2. All tests pass
3. Show user the UI link (http://localhost:5173/admin/*)
4. Tell user exactly what to verify
5. Check logs together
6. User approves
7. ONLY THEN commit

### Rule 5: No Authentication Bypass
- Use real admin user with real permissions in database
- Test with actual JWT authentication flow
- Ensure `admin:*` permission is enforced

---

## Phase Checklist

### Phase 1: Dashboard Overview - COMPLETE
- [x] Stats cards with real counts
- [x] Activity feed with real audit logs
- [x] Login page with Supabase Auth
- [x] Real database integration verified

### Phase 2: User Management - PENDING
Before starting:
- [ ] Launch agents to study: user.service.ts, users.ts routes, user adapter, user types
- [ ] Understand list/get/suspend/reactivate user flows
- [ ] Then build frontend

### Phase 3: Audit Logs - PENDING
### Phase 4: Knowledge Base - PENDING
### Phase 5: Approval Workflow - PENDING
### Phase 6: Chat Management - PENDING
### Phase 7: Tool Management - PENDING
### Phase 8: Analytics - PENDING
### Phase 9: Settings & Security - PENDING

---

## Commit Message Format
```
feat(admin): Phase X - [Feature Name]

- What was added
- What was tested
- Real data verification: [counts/items verified]
```
