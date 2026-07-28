import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const CollaborationComments = ({ comments, currentUserId, onAddComment }) => {
    const [newComment, setNewComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const commentsEndRef = useRef(null);

    // Auto-scroll to bottom when new comments are added
    useEffect(() => {
        if (commentsEndRef.current) {
            commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [comments.length]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!newComment.trim() || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await onAddComment(newComment.trim());
            setNewComment('');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

        // Show date and time for older messages
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Group comments by date
    const groupedComments = comments.reduce((groups, comment) => {
        const date = comment.createdAt?.toDate?.() || new Date();
        const dateKey = date.toDateString();

        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(comment);
        return groups;
    }, {});

    const formatDateHeader = (dateString) => {
        const date = new Date(dateString);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    };

    return (
        <div className="flex flex-col h-[500px] bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {Object.keys(groupedComments).length > 0 ? (
                    Object.entries(groupedComments).map(([dateKey, dateComments]) => (
                        <div key={dateKey}>
                            {/* Date Header */}
                            <div className="flex items-center justify-center my-4">
                                <div className="flex-1 border-t border-gray-200" />
                                <span className="px-3 text-xs text-gray-500 font-medium">
                                    {formatDateHeader(dateKey)}
                                </span>
                                <div className="flex-1 border-t border-gray-200" />
                            </div>

                            {/* Comments for this date */}
                            {dateComments.map((comment, index) => {
                                const isOwn = comment.authorId === currentUserId;
                                const showAvatar = index === 0 ||
                                    dateComments[index - 1]?.authorId !== comment.authorId;

                                return (
                                    <div
                                        key={comment.id}
                                        className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''} ${!showAvatar ? 'mt-1' : 'mt-4'}`}
                                    >
                                        {/* Avatar */}
                                        {showAvatar ? (
                                            <Link
                                                to={`/profile/${comment.authorId}`}
                                                className="flex-shrink-0"
                                            >
                                                {comment.authorAvatarUrl ? (
                                                    <img
                                                        src={comment.authorAvatarUrl}
                                                        alt={comment.authorUsername}
                                                        className="w-8 h-8 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                                        <span className="text-purple-600 font-medium text-sm">
                                                            {comment.authorUsername?.charAt(0).toUpperCase() || '?'}
                                                        </span>
                                                    </div>
                                                )}
                                            </Link>
                                        ) : (
                                            <div className="w-8 flex-shrink-0" />
                                        )}

                                        {/* Message Bubble */}
                                        <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                                            {showAvatar && (
                                                <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                                    <Link
                                                        to={`/profile/${comment.authorId}`}
                                                        className="text-sm font-medium text-gray-700 hover:text-purple-600"
                                                    >
                                                        {comment.authorUsername}
                                                    </Link>
                                                    <span className="text-xs text-gray-400">
                                                        {formatTime(comment.createdAt)}
                                                    </span>
                                                </div>
                                            )}
                                            <div
                                                className={`px-4 py-2 rounded-2xl ${
                                                    isOwn
                                                        ? 'bg-purple-500 text-white rounded-br-sm'
                                                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                                                }`}
                                            >
                                                <p className="text-sm whitespace-pre-wrap break-words">
                                                    {comment.content}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <Icon path={ICONS.edit} className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="font-medium">No comments yet</p>
                        <p className="text-sm">Start the conversation!</p>
                    </div>
                )}
                <div ref={commentsEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Write a message..."
                        maxLength={1000}
                        className="flex-1 px-4 py-2 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-colors"
                        disabled={!currentUserId}
                    />
                    <button
                        type="submit"
                        disabled={!newComment.trim() || isSubmitting || !currentUserId}
                        className={`p-2 rounded-full transition-colors ${
                            newComment.trim() && !isSubmitting
                                ? 'bg-purple-500 hover:bg-purple-600 text-white'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        <Icon path={ICONS.share} className="w-5 h-5 rotate-90" />
                    </button>
                </div>
                {!currentUserId && (
                    <p className="text-xs text-gray-500 mt-2 text-center">
                        Sign in to leave comments
                    </p>
                )}
            </form>
        </div>
    );
};

export default CollaborationComments;
