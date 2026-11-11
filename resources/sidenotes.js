( function () {
	function copyFallback( text, done, fail ) {
		var ta = document.createElement( 'textarea' );
		ta.value = text;
		ta.setAttribute( 'readonly', '' );
		ta.style.position = 'absolute';
		ta.style.left = '-9999px';
		document.body.appendChild( ta );
		ta.select();
		ta.setSelectionRange( 0, text.length );
		var ok = false;
		try {
			ok = document.execCommand( 'copy' );
		} catch ( e ) {}
		document.body.removeChild( ta );
		if ( ok ) {
			done();
		} else if ( fail ) {
			fail();
		}
	}

	var SidenoteManager = function ( notes, opts ) {
		this.opts = opts || {};
		this.opts.padding = this.opts.padding || 10;
		this.opts.idRegex = this.opts.idRegex || /^mw-inlinecomment-aside-/;
		this.opts.annotationClassPrefix = 'mw-annotation-';
		this.opts.selectedClass = this.opts.selectedClass  || 'mw-inlinecomment-selected';
		this.opts.selectedAnnotationClass = this.opts.selectedAnnotationClass  || 'mw-annotation-selected';
		this.opts.visibleClass = this.opts.visibleClass || 'mw-inlinecomment-visible';
		this.opts.contentContainer = this.opts.contentContainer ||
			document.querySelector( '#mw-content-text .mw-parser-output' ) ||
			document.querySelector( '#mw-content-text' );

		this.items = [];
		this.selectedItemId = null;
		this.hoverTimer = null;
		this.hoveredId = null;

		for ( var i = 0; i < notes.length; i++ ) {
			var annotationClass = notes[i].id.replace(
				this.opts.idRegex,
				this.opts.annotationClassPrefix
			);
			var annotations = document.getElementsByClassName( annotationClass );
			var highlight = annotations.length >= 1 ? annotations[0] : null;

			this.items[this.items.length] = {
				element: notes[i],
				highlight: highlight,
			};

			let id = notes[i].id;
			let that = this;

			notes[i].addEventListener(
				'click',
				function (event) {
					event.stopPropagation();
					that.toggleSelect( id );
				}
			);

			// Hovering any highlighted fragment (or the panel itself) shows
			// the panel. Attach to every fragment because a single annotation
			// can span several elements. The panel fades out only once the
			// mouse leaves both the highlight and the panel.
			var attachHover = function ( elm, isHighlight ) {
				elm.addEventListener(
					'mouseenter',
					function ( event ) {
						event.stopPropagation();
						that.cancelHideTimer();
						that.hoveredId = id;
						that.showNear( id, isHighlight ? this : null );
					}
				);
				elm.addEventListener(
					'mouseleave',
					function ( event ) {
						event.stopPropagation();
						that.hoveredId = null;
						that.scheduleHide( id );
					}
				);
			};

			for ( var j = 0; j < annotations.length; j++ ) {
				attachHover( annotations[j], true );
			}
			attachHover( notes[i], false );

			if ( mw.config.get( 'wgInlineCommentsCanEdit' ) === true ) {
				this.addTools( notes[i] );
			}
		}

		// Start with all panels hidden so there is no flash/glitch on refresh.
		this.renderUnselected();
		this.updateLayout();

		// Delegated handler for the "Copy link" button — works for both
		// editable and non-editable viewers, and for dynamically added panels.
		var self = this;
		$( document ).on( 'click', '.mw-inlinecomment-copylink', function ( e ) {
			e.stopPropagation();
			e.preventDefault();
			var annId = $( this ).attr( 'data-annotation-id' );
			if ( !annId ) {
				var aside = $( this ).closest( '.mw-inlinecomment-aside' );
				if ( aside.length ) {
					annId = aside.attr( 'id' ) || '';
				}
			}
			if ( annId ) {
				var fullId = annId.indexOf( 'mw-inlinecomment-aside-' ) === 0 ?
					annId :
					'mw-inlinecomment-aside-' + annId;
				self.copyLink( fullId );
			}
		} );
	};

	SidenoteManager.prototype = {
		// Hide every panel (called on init and on click-away). Panels with a
		// visible comment input box are never hidden.
		renderUnselected: function () {
			for ( var i = 0; i < this.items.length; i++ ) {
				var panelId = this.items[i].element.id;
				if ( this.hasVisibleInput( panelId ) ) {
					continue;
				}
				this.hide( panelId );
			}
			this.deselectAnnotation();
			this.selectedItemId = null;
			$('.mw-inlinecomment-editlink').show();
		},

		cancelHideTimer: function () {
			if ( this.hoverTimer !== null ) {
				clearTimeout( this.hoverTimer );
				this.hoverTimer = null;
			}
		},

		// Schedule a panel to fade out once the mouse leaves both the
		// highlight and the panel. Aborted if something is still hovered,
		// the panel is selected/sticky, or a comment input box is visible.
		scheduleHide: function ( id ) {
			if ( this.hoveredId !== null ) {
				return;
			}
			if ( this.selectedItemId === id ) {
				return;
			}
			if ( this.hasVisibleInput( id ) ) {
				return;
			}
			var that = this;
			this.hoverTimer = setTimeout( function () {
				that.hide( id );
			}, 150 );
		},

		// Check whether the comment input box inside the panel is currently
		// visible (e.g. the user is composing a comment). Panels stay open in
		// that case regardless of mouse position.
		hasVisibleInput: function ( id ) {
			var aside = document.getElementById( id );
			if ( !aside ) {
				return false;
			}
			var textareas = aside.querySelectorAll( 'textarea' );
			for ( var i = 0; i < textareas.length; i++ ) {
				var ta = textareas[i];
				if ( ta.offsetWidth > 0 && ta.offsetHeight > 0 ) {
					return true;
				}
			}
			return false;
		},

		// Delete a reply comment. Only the author can delete their own reply.
		deleteReply: function ( asideId, commentIdx, commentElem, onSuccess ) {
			var that = this;
			mw.loader.using( 'mediawiki.api', function () {
				var api = new mw.Api();
				api.postWithToken( 'csrf', {
					title: mw.config.get( 'wgPageName' ),
					id: asideId,
					comment_idx: commentIdx,
					action: 'inlinecomments-delete-reply'
				} ).then( function () {
					// Remove the comment element from the DOM
					$( commentElem ).remove();
					// If no comments remain, remove the whole panel
					var remaining = $( '#mw-inlinecomment-aside-' + asideId ).find( '.mw-inlinecomment-comment' );
					if ( remaining.length === 0 ) {
						that.remove( 'mw-inlinecomment-aside-' + asideId );
					} else if ( onSuccess ) {
						// Indices of the remaining comments shifted, so let the
						// caller refresh its edit/delete handlers.
						onSuccess();
					}
				} ).fail( function ( code, data ) {
					mw.notify( api.getErrorMessage( data ), { type: 'error' } );
				} );
			} );
		},

		// Get the vertical offset of an element relative to the content container.
		getOffset: function ( elm ) {
			var container = this.opts.contentContainer;
			if ( !container || !elm || elm.nodeType !== 1 ) {
				return 0;
			}
			var offset = 0, cur = elm;
			do {
				offset += cur.offsetTop || 0;
				cur = cur.offsetParent;
			} while ( cur && cur !== container );
			return offset;
		},

		// Fade out a panel. Relies on CSS for the transition; no inline
		// display/visibility changes so that :hover can keep it visible.
		hide: function ( id ) {
			var aside = document.getElementById( id );
			if ( !aside ) {
				return;
			}
			if ( this.hasVisibleInput( id ) ) {
				return;
			}
			aside.classList.remove( this.opts.visibleClass );
			aside.classList.remove( this.opts.selectedClass );
			if ( this.selectedItemId === id ) {
				this.selectedItemId = null;
			}
		},

		// Union bounding rect of every highlighted fragment for an annotation.
		// A single selection can produce several spans (inline elements or
		// paragraph boundaries), so measuring only the first one can place the
		// panel on top of another part of the same annotation.
		getHighlightRect: function ( id ) {
			var annotationClass = id.replace(
				this.opts.idRegex,
				this.opts.annotationClassPrefix
			);
			var elements = document.getElementsByClassName( annotationClass );
			var rect = null;
			for ( var i = 0; i < elements.length; i++ ) {
				var r = elements[i].getBoundingClientRect();
				if ( r.width === 0 && r.height === 0 ) {
					continue;
				}
				if ( !rect ) {
					rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
				} else {
					rect.left = Math.min( rect.left, r.left );
					rect.top = Math.min( rect.top, r.top );
					rect.right = Math.max( rect.right, r.right );
					rect.bottom = Math.max( rect.bottom, r.bottom );
				}
			}
			return rect;
		},

		// Position a panel beside its highlight (FloatingUI style). Placement is
		// to the right of the annotated text by default, never overlapping it.
		// If the panel would fall out of the bottom of the viewport, it flips
		// above the annotation (FloatingUI's flip middleware). If there isn't
		// room on the right, the panel is placed above the annotation (and
		// finally below it). Whatever placement is chosen, a final shift keeps
		// the panel inside the viewport (FloatingUI's shift middleware).
		showNear: function ( id, fragment ) {
			var item = this.findItem( id );
			if ( !item ) {
				return;
			}
			var aside = item.element;
			var highlight = item.highlight;
			var container = this.opts.contentContainer;
			if ( !aside || !container ) {
				return;
			}

			// Measure the panel while it is still invisible (visibility:hidden
			// elements keep their layout, so these dimensions are real).
			aside.style.position = 'absolute';
			var asideWidth = aside.offsetWidth;
			var asideHeight = aside.offsetHeight;

			// Panels live in #mw-inlinecomment-annotations, which is a sibling
			// of .mw-parser-output in most skins. Their offsetParent is
			// therefore usually <body>, not the parser output. Convert from
			// viewport coordinates into the offsetParent's coordinate space so
			// the panel is placed next to the text in every skin.
			var offsetParent = aside.offsetParent || document.body;
			var parentRect = offsetParent.getBoundingClientRect();
			var originTop = parentRect.top + offsetParent.clientTop;
			var originLeft = parentRect.left + offsetParent.clientLeft;
			var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
			var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
			var margin = this.opts.padding;
			var gap = this.opts.padding;

			var top, left;
			var hRect = this.getHighlightRect( id );
			if ( hRect ) {
				var anchorEl = fragment || highlight;
				var anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : hRect;
				var viewportLeft, viewportTop;

				if ( hRect.right + gap + asideWidth + margin <= viewportWidth ) {
					// Preferred: immediately to the right of the annotation,
					// measured against every highlighted fragment so no part of
					// the annotation can be covered.
					viewportLeft = hRect.right + gap;
					viewportTop = anchorRect.top;

					// FloatingUI-style flip: if the panel would overflow the
					// bottom of the viewport (e.g. the annotation sits at the
					// very bottom of the page), place it above the whole
					// annotation instead. If above doesn't fit either, place
					// it below the annotation.
					if ( viewportTop + asideHeight + margin > viewportHeight ) {
						var aboveTop = hRect.top - asideHeight - gap;
						var belowTop = hRect.bottom + gap;
						if ( aboveTop >= margin ) {
							viewportTop = aboveTop;
						} else if ( belowTop + asideHeight + margin <= viewportHeight ) {
							viewportTop = belowTop;
						}
					}
				} else {
					// No horizontal room: go above the whole annotation, and
					// only fall back to below it. Both keep a vertical gap, so
					// the highlighted text is never obscured.
					viewportLeft = anchorRect.left;
					viewportTop = hRect.top - asideHeight - gap;
					if ( viewportTop < margin ) {
						viewportTop = hRect.bottom + gap;
					}
				}

				// FloatingUI-style shift: keep the panel inside the viewport
				// even when neither flipped nor side placement fits.
				viewportLeft = Math.max(
					margin,
					Math.min( viewportLeft, viewportWidth - asideWidth - margin )
				);
				viewportTop = Math.max(
					margin,
					Math.min( viewportTop, viewportHeight - asideHeight - margin )
				);

				top = viewportTop - originTop;
				left = viewportLeft - originLeft;
			} else {
				// Brand-new comment without a saved highlight yet: place near
				// the top of the content area.
				top = 0;
				left = 0;
			}

			aside.style.top = top + 'px';
			aside.style.left = left + 'px';

			// Force a reflow so the browser registers the hidden state,
			// then add the visible class in the next animation frame so the
			// CSS transition (fade + slide) actually plays.
			aside.offsetHeight;
			var self = this;
			requestAnimationFrame( function () {
				// The pointer may have left (or the panel may have been hidden)
				// before this frame runs. Only reveal the panel if it is still
				// supposed to be open, otherwise a quick hover-out could fade
				// it back in and leave it stranded on screen.
				var stillWanted =
					self.hoveredId === id ||
					self.selectedItemId === id ||
					aside.classList.contains( self.opts.selectedClass ) ||
					self.hasVisibleInput( id );
				if ( stillWanted ) {
					aside.classList.add( self.opts.visibleClass );
				}
			} );
		},

		// Show panel near highlight and keep it open (sticky selection on click).
		toggleSelect: function ( id ) {
			var item = this.findItem( id );
			if ( !item ) {
				// Unknown annotation (e.g. a stale #annotation-<id> anchor
				// from an annotation that has been deleted): do nothing.
				return;
			}
			if ( this.selectedItemId === id ) {
				this.hide( id );
				this.deselectAnnotation();
				return;
			}

			if ( this.selectedItemId !== null ) {
				this.hide( this.selectedItemId );
			}

			this.selectedItemId = id;
			this.showNear( id );
			item.element.classList.add( this.opts.selectedClass );
			this.selectAnnotation( id );

			var rect = item.element.getBoundingClientRect();
			var html = document.documentElement;
			if (
				rect.bottom <= 0 ||
				rect.right <= 0 ||
				rect.left >= html.clientWidth ||
				rect.top >= html.clientHeight
			) {
				item.element.scrollIntoView( false );
			}

			$('.mw-inlinecomment-editlink').show();
		},

		findItem: function ( id ) {
			for ( var i = 0; i < this.items.length; i++ ) {
				if ( this.items[i].element.id === id ) {
					return this.items[i];
				}
			}
			return null;
		},

		// Deselect a panel so it returns to normal hover behavior instead of
		// staying sticky-open. Called after a new comment is saved.
		deselect: function ( id ) {
			if ( this.selectedItemId === id ) {
				this.selectedItemId = null;
			}
			var aside = document.getElementById( id );
			if ( aside ) {
				aside.classList.remove( this.opts.selectedClass );
			}
			this.deselectAnnotation();
		},

		// Copy the annotation link (#annotation-<id>) to the clipboard.
		// Called from the "Copy link" button next to the Edit button.
		copyLink: function ( annotationId ) {
			var uuid = annotationId.replace( this.opts.idRegex, '' );
			if ( !uuid ) {
				return;
			}
			var url = window.location.origin + window.location.pathname +
				window.location.search + '#annotation-' + uuid;
			var done = function () {
				try {
					mw.notify( mw.msg( 'inlinecomments-copy-link-copied' ), { type: 'success' } );
				} catch ( e ) {}
			};
			var fail = function () {
				try {
					mw.notify( mw.msg( 'inlinecomments-copy-link-failed' ), { type: 'error' } );
				} catch ( e ) {}
			};
			if ( navigator.clipboard && navigator.clipboard.writeText ) {
				navigator.clipboard.writeText( url ).then( done, function () {
					// Fallback for non-secure contexts
					copyFallback( url, done, fail );
				} );
			} else {
				copyFallback( url, done, fail );
			}
		},

		deselectAnnotation: function () {
			var annotations = document.getElementsByClassName( this.opts.selectedAnnotationClass );
			for ( var i = annotations.length - 1; i >= 0; i-- ) {
				annotations[i].classList.remove( this.opts.selectedAnnotationClass );
			}
		},

		selectAnnotation: function ( id ) {
			var annotationClass = id.replace(
				this.opts.idRegex,
				this.opts.annotationClassPrefix
			);
			var annotations = document.getElementsByClassName( annotationClass );
			for ( var i = 0; i < annotations.length; i++ ) {
				annotations[i].classList.add( this.opts.selectedAnnotationClass );
			}
		},

		updateLayout: function () {
			var $content = $( this.opts.contentContainer );
			if ( !$content.length ) {
				return;
			}
			$content.addClass( 'mw-inlinecomments-content' );
			var $annotations = $( '#mw-inlinecomment-annotations' );
			if ( $annotations.length ) {
				$content.addClass( 'mw-inlinecomments-has-annotations' );
			}
		},

		// Add a new sidenote and select it. Assumed already inserted into dom.
		add: function ( element, offset ) {
			this.items[this.items.length] = {
				element: element,
				highlight: null,
			};
			element.style.position = 'absolute';

			// Locate the highlight span created by highlightRange() so we can
			// position the new panel next to the annotated text.
			var highlightId = element.id.replace( this.opts.idRegex, '' );
			var highlightEls = document.querySelectorAll(
				'[data-mw-highlight-id="' + highlightId + '"]'
			);
			if ( highlightEls.length === 0 ) {
				highlightEls = document.querySelectorAll(
					'.' + this.opts.annotationClassPrefix + highlightId
				);
			}
			if ( highlightEls.length ) {
				this.items[this.items.length - 1].highlight = highlightEls[0];
			}

			this.selectedItemId = element.id;
			this.showNear( element.id, highlightEls[0] || null );
			element.classList.add( this.opts.selectedClass );
			this.selectAnnotation( element.id );

			let that = this;
			element.addEventListener(
				'click',
				function (event) {
					event.stopPropagation();
					that.toggleSelect( this.id );
				}
			);

			// Attach hover listeners so the panel shows/hides on hover
			// just like pre-existing annotations do in the constructor.
			for ( var h = 0; h < highlightEls.length; h++ ) {
				highlightEls[h].addEventListener(
					'mouseenter',
					function (event) {
						event.stopPropagation();
						that.cancelHideTimer();
						that.hoveredId = element.id;
						that.showNear( element.id, this );
					}
				);
				highlightEls[h].addEventListener(
					'mouseleave',
					function (event) {
						event.stopPropagation();
						that.hoveredId = null;
						that.scheduleHide( element.id );
					}
				);
			}
			element.addEventListener(
				'mouseenter',
				function (event) {
					event.stopPropagation();
					that.cancelHideTimer();
					that.hoveredId = element.id;
				}
			);
			element.addEventListener(
				'mouseleave',
				function (event) {
					event.stopPropagation();
					that.hoveredId = null;
					that.scheduleHide( element.id );
				}
			);
			this.updateLayout();
		},

		remove: function ( id ) {
			this.items = this.items.filter( function (a) {
				if ( a.element.id === id ) {
					a.element.remove();
					return false;
				}
				return true;
			} );
			var highlightClass = id.replace(
				this.opts.idRegex,
				this.opts.annotationClassPrefix
			);
			var hls = document.getElementsByClassName( highlightClass );
			for ( let i = hls.length - 1; i >= 0; i-- ) {
				hls[i].classList.remove( 'mw-annotation-highlight' );
				hls[i].classList.remove( highlightClass );
			}
			if ( this.selectedItemId === id ) {
				this.selectedItemId = null;
			}
			this.renderUnselected();
		},

		// Add "Reply", "Close discussion", and "Delete reply" buttons to an aside.
		addTools: function ( aside ) {
			var that = this;
			var asideId = aside.id.replace( this.opts.idRegex, '' );
			var toolsDiv = document.createElement( 'div' );
			toolsDiv.className = 'mw-inlinecomment-tools';
			var replyButton = new OO.ui.ButtonInputWidget( {
				label: mw.msg( 'inlinecomments-addcomment-reply' ),
				flags: [ 'progressive' ]
			} );
			var closeDiscussionButton = new OO.ui.ButtonInputWidget( {
				label: mw.msg( 'inlinecomments-addcomment-close' ),
				flags: [ 'desctructive' ]
			} );

			var textbox = new OO.ui.MultilineTextInputWidget( {
				value: '',
				autosize: true,
				placeholder: mw.msg( 'inlinecomments-placeholder' )
			} );
			var saveReplyButton = new OO.ui.ButtonInputWidget( {
				label: mw.msg( 'inlinecomments-addcomment-save' ),
				flags: [ 'primary', 'progressive' ]
			} );
			var cancelReplyButton = new OO.ui.ButtonInputWidget( {
				label: mw.msg( 'inlinecomments-addcomment-cancel' ),
				flags: [ 'destructive' ]
			} );
			var autocompleteDropdown = $( '<div></div>' );
			autocompleteDropdown.attr( 'class', 'userAutocompleteDropdown' );
			autocompleteDropdown.hide();
			if ( $( '.userAutocompleteDropdown' ).length === 0 ) {
				textbox.$element.append( autocompleteDropdown[0] );
			}

			var initializeEditFunc = function () {
				$( aside ).find( '.mw-inlinecomment-comment' ).each( function ( idx, commentElem ) {
					$( commentElem ).find( '.mw-inlinecomment-editlink' )
						.off( 'click' )
						.on( 'click', function ( event ) {
							$( aside ).find( '.mw-inlinecomment-editlink' ).show();
							$( this ).hide();
							editClickFunc( event, idx, $( commentElem ) );
						} );
					// Copy link clicks are handled via delegated listener on
					// document (see SidenoteManager constructor) so they also
					// work for non-editable viewers.
					// Add delete reply button click handler. Deleting a comment
					// always leaves edit mode, so a stale "Publish edit"/"Cancel"
					// form cannot be left behind.
					$( commentElem ).find( '.mw-inlinecomment-delete-reply' )
						.off( 'click' )
						.on( 'click', function ( event ) {
							event.stopPropagation();
							cancelReplyFunc();
							that.deleteReply( asideId, idx, commentElem, function () {
								initializeEditFunc();
							} );
						} );
				} );
			};

			var saveReplyFunc = function () {
				saveReplyButton.setDisabled( true );
				mw.loader.using( 'mediawiki.api', function () {
					var api = new mw.Api();
					var text = textbox.getValue().trim();
					var data = {
						title: mw.config.get( 'wgPageName' ),
						id: asideId,
						action: 'inlinecomments-addreply',
						comment: text
					};
					api.postWithToken( 'csrf', data ).then( function (res) {
						const commentHTML = res['inlinecomments-addreply'].comment;
						textbox.setValue('');
						var textDiv = $( aside ).find('.mw-inlinecomment-text')[0];
						const DOMs = $.parseHTML( commentHTML );
						$('.mw-inlinecomment-editlink').show();
						textDiv.appendChild( DOMs[0] );
						toolsDiv.replaceChildren( replyButton.$element[0], closeDiscussionButton.$element[0] );
						initializeEditFunc();
					} ).fail( function ( code, data ) {
						mw.notify( api.getErrorMessage( data ), { type: 'error' } );
					} );
				} );
			};
			var cancelReplyFunc = function () {
				textbox.setValue('');
				saveReplyButton.setLabel( mw.msg( 'inlinecomments-addcomment-save' ) );
				toolsDiv.replaceChildren( replyButton.$element[0], closeDiscussionButton.$element[0] );
				$( aside ).find( '.currentedit' ).removeClass( 'currentedit' );
				$( aside ).find( '.mw-inlinecomment-editlink' ).show();
			};
			var replyFunc = function (edit=false, existingCommentObject=null,
				commentIdx=null) {
				if ( edit ) {
					existingCommentObject.addClass('currentedit');
				}
				textbox.$element.keyup( async function ( event ) {
					saveReplyButton.setDisabled( textbox.getValue().trim() === '' );
					autocompleteDropdown.val( '' );
					var cursorPosition = event.target.selectionStart;
					var textBeforeCursor = event.target.value.substring( 0, cursorPosition );
					var textAfterCursor = event.target.value.substring( cursorPosition );
					var atIndex = textBeforeCursor.lastIndexOf( '@' );
					if ( atIndex !== -1 ) {
						var query = textBeforeCursor.substring( atIndex + 1 );
						if ( query.length > 0 ) {
							const api = new mw.Api();
							const requestParams = {
								'action': 'query',
								'format': 'json',
								'list': 'allusers',
								'auprefix': query,
								'aulimit': 5,
								'auprop': 'blockinfo'
							};
							let response = await api.get( requestParams );
							const usernames = response.query.allusers.map( function ( user ) {
								if ( !Object.keys( user ).includes( 'hidden' ) ) {
									return user.name;
								}
							} );
							const usernamesDivs = usernames.map( function ( username ) {
								let item = $('<a></a>');
								item.attr( 'class', 'userAutocompleteDropdownItem' );
								item.text( username );
								item.on( 'click', function () {
									username = username.replace( ' ', '_' );
									var newText = textBeforeCursor.substring( 0, atIndex + 1 ) + username + ' ';
									event.target.value = newText + textAfterCursor;
									event.target.selectionStart = event.target.selectionEnd = newText.length;
									autocompleteDropdown.hide();
								} );
								return item;
							} );
							autocompleteDropdown.empty();
							if( usernames.length > 0 ) {
								usernamesDivs.forEach( function ( div ) {
									autocompleteDropdown.append( div );
								});
								autocompleteDropdown.show();
							} else {
								autocompleteDropdown.hide();
							}
							event.currentTarget.append( autocompleteDropdown[0] );
						} else {
							autocompleteDropdown.hide();
						}
					} else {
						autocompleteDropdown.hide();
					}
				} );
				saveReplyButton.$element.unbind('click').click( function () {
					if ( edit ) {
						editCommentFunc( existingCommentObject, commentIdx );
						edit = false;
					} else {
						saveReplyFunc();
					}
				} );
				cancelReplyButton.$element.unbind('click').click( cancelReplyFunc );
				var buttonsDiv = document.createElement( 'div' );
				buttonsDiv.className = 'mw-inlinecomment-buttons';
				buttonsDiv.replaceChildren(  saveReplyButton.$element[0], cancelReplyButton.$element[0] );
				toolsDiv.replaceChildren( textbox.$element[0], buttonsDiv );
			};
			var editCommentFunc = function ( existingCommentObject, commentIdx ) {
				$('.currentedit').removeClass('currentedit');
				saveReplyButton.setDisabled( true );
				mw.loader.using( 'mediawiki.api', function () {
					var api = new mw.Api();
					var text = textbox.getValue().trim();
					const action = 'inlinecomments-editcomment';
					var data = {
						title: mw.config.get( 'wgPageName' ),
						id: asideId,
						action: action,
						comment: text,
						existing_comment_idx: commentIdx
					};
					api.postWithToken( 'csrf', data ).then( function (res) {
						const commentHTML = res[action].comment;
						textbox.setValue('');
						saveReplyButton.setLabel( mw.msg( 'inlinecomments-addcomment-save' ) );
						existingCommentObject.removeClass('currentedit');
						existingCommentObject[0].innerHTML = commentHTML;
						let editedLabel = $('<span></span>');
						editedLabel.addClass('mw-inlinecomments-editedlabel');
						editedLabel.text( ' ' + mw.msg( 'parentheses', mw.msg( 'inlinecomments-edited-label' ) ) );
						existingCommentObject.children().first().find('p').first().append(editedLabel);
						$('.mw-inlinecomment-editlink').show();
						initializeEditFunc();
					} ).fail( function ( code, data ) {
						mw.notify( api.getErrorMessage( data ), { type: 'error' } );
					} );
				} );
			};
			var closeDiscussionFunc = function () {
				closeDiscussionButton.setDisabled( true );
				mw.loader.using( 'mediawiki.api', function () {
					var api = new mw.Api();
					var data = {
						title: mw.config.get( 'wgPageName' ),
						id: asideId,
						action: 'inlinecomments-close'
					}
					api.postWithToken( 'csrf', data ).then( function () {
						that.remove( aside.id );
					} ).fail( function ( code, data ) {
						mw.notify( api.getErrorMessage( data ), { type: 'error' } );
					} );
				} );
			};

			var editClickFunc = function ( event, commentIdx, comment ) {
				event.preventDefault();
				textbox.setValue('');
				$( aside ).find( '.currentedit' ).removeClass( 'currentedit' );
				$(this).parent().addClass('currentedit');
				let existingComment = comment.children().first().children().first().clone(true);
				existingComment.find('span').remove();
				existingComment.find( 'bdi' ).each( function () {
					let current = $( this ).text();
					current = current.replaceAll( ' ', '_' );
					$( this ).text( current );
				} );
				let escapedHTML = existingComment.html().replaceAll( '<br>', '\n' );
				escapedHTML = $.parseHTML( escapedHTML );
				const processedContent = $( escapedHTML ).text();
				textbox.setValue(processedContent);
				saveReplyButton.setLabel( mw.msg( 'inlinecomments-editcomment-publish' ) );
				replyFunc(true, comment, commentIdx);
			};

			closeDiscussionButton.$element.click( closeDiscussionFunc );
			replyButton.$element.unbind('click').click( function () {
				replyFunc();
			} );
			$( toolsDiv ).append( replyButton.$element, closeDiscussionButton.$element );
			aside.appendChild( toolsDiv );
			initializeEditFunc();
		},
	};
	mw.inlineComments = mw.inlineComments || {};
	mw.inlineComments.SidenoteManager = SidenoteManager;
} )();
