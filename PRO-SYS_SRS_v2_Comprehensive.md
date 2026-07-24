
# PRO-SYS
## Software Requirements Specification (SRS)
**Version:** 2.0 (Comprehensive)

> This specification is intended to be detailed enough for AI-assisted development using Next.js, React, Node.js/NestJS, PostgreSQL and Prisma.

---

# Table of Contents

1. Vision
2. Goals
3. Scope
4. User Roles
5. Functional Requirements
6. User Stories
7. Modules
8. Navigation
9. UI Pages
10. Dashboard Specification
11. Reminder Engine
12. Recurrence Engine
13. Notification Engine
14. Calendar
15. Search & Filters
16. Reports
17. Database Design
18. API Specification
19. Validation Rules
20. Permission Matrix
21. Folder Structure
22. Tech Stack
23. Development Roadmap
24. Future Features

---

# 1. Vision

Build a modern "Life ERP" that helps a family remember and manage every recurring responsibility from one place.

---

# 2. Goals

- Never miss a due date
- Centralize financial and personal reminders
- Multi-user family support
- Flexible recurring schedules
- Fast search
- Simple UI
- Mobile responsive

---

# 3. Scope

Supported reminder types include:

- Insurance
- EMI
- SIP
- Credit Cards
- Taxes
- Passport
- Driving Licence
- Vehicle Service
- Medicine
- Birthdays
- Anniversaries
- Utility Bills
- Subscriptions
- Custom reminders

---

# 4. User Roles

## Admin

- Manage users
- Manage categories
- Manage reminders
- Assign reminders
- View all reports
- Manage settings

## Family Member

- View assigned reminders
- Complete reminders
- Add reminders (optional)
- View own history

---

# 5. Functional Requirements

## Authentication

- Login
- Logout
- Remember Me
- Password change
- Family invite

## Reminder Management

- Create
- Edit
- Delete
- Duplicate
- Archive
- Complete
- Reopen

## Category Management

- Custom colors
- Icons
- Default recurrence
- Enable/disable

## Dashboard

- Today's tasks
- Upcoming
- Overdue
- Calendar
- Recent activity
- Quick add
- Statistics

---

# 6. User Stories

- As an admin I can create recurring reminders.
- As a family member I can mark reminders completed.
- As a user I can search reminders instantly.
- As a user I can see overdue reminders.
- As a user I can review payment history.
- As a user I can assign reminders.

---

# 7. Modules

1. Authentication
2. User Management
3. Categories
4. Reminders
5. History
6. Notifications
7. Calendar
8. Reports
9. Settings
10. Activity Log

---

# 8. Navigation

Dashboard
├── Calendar
├── Reminders
│   ├── Active
│   ├── Completed
│   ├── Overdue
│   └── Archived
├── Categories
├── Reports
├── Notifications
├── Users
└── Settings

---

# 9. UI Pages

## Login

Fields

- Email
- Password
- Remember Me

## Dashboard

Widgets

- Today
- Upcoming
- Overdue
- Calendar
- Statistics
- Quick Add

## Reminder Form

Sections

- Basic Details
- Schedule
- Financial
- Vehicle
- Personal
- Notes

## Calendar

Views

- Day
- Week
- Month
- Agenda

## Reports

- Monthly
- Annual
- Category
- User
- Upcoming Expenses

---

# 10. Dashboard KPIs

- Total Active
- Due Today
- Overdue
- Completed This Month
- Upcoming This Week
- Monthly Spend
- Annual Forecast
- Recurring Count

---

# 11. Reminder Engine

Each reminder contains

- Metadata
- Category
- Assigned User
- Due Date
- Custom reminder offsets
- Status
- History
- Next occurrence

Lifecycle

Draft → Active → Due → Completed → Next Generated

---

# 12. Recurrence Engine

Supports

- One Time
- Daily
- Weekly
- Monthly
- Quarterly
- Half-Yearly
- Yearly
- Every X Days
- Every X Weeks
- Every X Months
- Every X Years
- Fully Custom

Rule:

Upon completion, generate next reminder if recurrence enabled.

---

# 13. Notification Engine

V1

- Dashboard alerts

Future-ready

- Email
- WhatsApp
- SMS
- Push

Notification states

Unread → Read → Archived

---

# 14. Search

Global search

Filters

- Category
- User
- Date
- Status
- Priority
- Amount
- Vehicle
- Tags

---

# 15. Reports

- Upcoming Expenses
- Insurance Summary
- Payment History
- Monthly Spending
- Annual Spending
- User Productivity
- Category Distribution

---

# 16. Database

## users

id
name
email
password_hash
role

## categories

id
name
icon
color

## reminders

id
title
description
category_id
assigned_to
priority
status
due_date
next_due_date
recurrence_rule
amount

## reminder_history

id
reminder_id
completed_on
amount
status
remarks

## notifications

id
user_id
message
read

## activity_logs

id
user_id
action
entity
timestamp

---

# 17. REST API

Authentication

POST /auth/login

POST /auth/logout

Users

GET /users

POST /users

PATCH /users/:id

DELETE /users/:id

Reminders

GET /reminders

POST /reminders

GET /reminders/:id

PATCH /reminders/:id

DELETE /reminders/:id

POST /reminders/:id/complete

Categories

CRUD endpoints

Reports

GET /reports/monthly

GET /reports/yearly

Notifications

GET /notifications

PATCH /notifications/:id/read

---

# 18. Validation Rules

- Due date required
- Title required
- Amount >= 0
- Assigned user required
- Completed reminders immutable except admin
- Duplicate titles allowed

---

# 19. Permission Matrix

| Feature | Admin | Member |
|---|---|---|
|Create Reminder|✓|Optional|
|Edit Any|✓|Own|
|Delete|✓|No|
|Reports|✓|Limited|
|Manage Users|✓|No|

---

# 20. Recommended Folder Structure

frontend/
  app/
  components/
  hooks/
  lib/
  services/
  types/

backend/
  src/
    auth/
    users/
    reminders/
    categories/
    notifications/
    reports/
    prisma/

---

# 21. Technology

Frontend

- Next.js
- React
- Tailwind
- TypeScript

Backend

- NestJS (preferred)
- Prisma

Database

- PostgreSQL

Realtime

- Socket.IO (future)

---

# 22. Development Phases

## V1

- Authentication
- Dashboard
- Reminder CRUD
- Categories
- Calendar
- History

## V2

- Reports
- Forecasting
- Shared reminders
- Attachments

## V3

- WhatsApp
- Email
- OCR
- AI Suggestions
- Mobile App

---

# 23. UI/UX Guidelines

- Minimal
- Card-based
- Color-coded categories
- Large dashboard widgets
- Responsive
- Dark mode support

---

# 24. AI Coding Prompt

Objective:
Build a production-ready PRO-SYS using Next.js 15, React, TypeScript, Tailwind CSS, NestJS, Prisma and PostgreSQL.

Requirements:
- Clean architecture
- Server actions where appropriate
- Responsive UI
- Modular code
- REST APIs
- Prisma migrations
- JWT authentication
- Recurring reminder engine
- Dashboard
- Calendar
- Reports
- Search
- Activity logging
- Future-ready architecture

Success Criteria:
The application should be capable of managing thousands of reminders while remaining intuitive for family use.
