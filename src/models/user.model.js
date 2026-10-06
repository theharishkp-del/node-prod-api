'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const mongoose = require('mongoose');

const scrypt = promisify(crypto.scrypt);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      unique: true,
    },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Stored as "salt:hash" (scrypt). Never selected by default, never serialised.
    password: { type: String, required: true, select: false },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  },
);

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(this.password, salt, 64);
  this.password = `${salt}:${hash.toString('hex')}`;
});

userSchema.methods.verifyPassword = async function verifyPassword(candidate) {
  const [salt, stored] = String(this.password || '').split(':');
  if (!salt || !stored) return false;
  const hash = await scrypt(candidate, salt, 64);
  const storedBuf = Buffer.from(stored, 'hex');
  return storedBuf.length === hash.length && crypto.timingSafeEqual(storedBuf, hash);
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
