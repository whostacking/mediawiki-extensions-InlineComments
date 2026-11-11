$( function () {
	var $content = $( '#mw-content-text > .mw-parser-output' ).first();
	if ( !$content.length ) {
		return;
	}

	// Make the parser output the positioning context for annotation panels.
	$content.addClass( 'mw-inlinecomments-content' );

	var $annotations = $( '#mw-inlinecomment-annotations' );
	if ( $annotations.length ) {
		$content.addClass( 'mw-inlinecomments-has-annotations' );
	}

	var noteElms = document.querySelectorAll(
		'#mw-content-text #mw-inlinecomment-annotations .mw-inlinecomment-aside'
	);
	var sidenoteManager = new mw.inlineComments.SidenoteManager(
		noteElms
	);

	var elms = document.querySelectorAll( '#mw-content-text .mw-annotation-highlight' );
	elms.forEach( function ( elm ) {
		if ( !elm.dataset.mwHighlightId ) {
			return;
		}

		// Resolve the annotation id at event time rather than capturing it,
		// so the correct annotation is always toggled even if the DOM was
		// updated after this handler was attached.
		//
		// Annotations can be nested (one annotation inside another). Using
		// the bubble phase means the innermost annotation's handler runs
		// first and stops propagation, so clicking a nested highlight toggles
		// the inner annotation, not its parent.
		elm.addEventListener(
			'click',
			function ( event ) {
				event.stopPropagation();
				var highlightId = this.dataset.mwHighlightId;
				if ( highlightId ) {
					sidenoteManager.toggleSelect( 'mw-inlinecomment-aside-' + highlightId );
				}
			}
		);
	} );

	mw.inlineComments.manager = sidenoteManager;

	// If the URL has an #annotation-<id> anchor (e.g. pasted from the
	// "Copy link" button), scroll to the annotation and open its panel.
	// Hovering or clicking no longer sets the anchor — only the explicit
	// copy action does.
	var annotationAnchor = window.location.hash.match( /^#annotation-([A-Za-z0-9_-]+)$/ );
	if ( annotationAnchor ) {
		var anchorHighlight = document.querySelector(
			'#mw-content-text .mw-annotation-' + annotationAnchor[ 1 ]
		);
		if ( anchorHighlight ) {
			anchorHighlight.scrollIntoView( { block: 'center' } );
		}
		sidenoteManager.toggleSelect(
			'mw-inlinecomment-aside-' + annotationAnchor[ 1 ]
		);
	}

	// Click anywhere else closes the panel.
	document.addEventListener(
		'click',
		function (e) {
			if (
				e.target.tagName === 'TEXTAREA' ||
				e.target.classList.contains( 'oo-ui-labelElement-label' ) ||
				e.target.closest( '.mw-inlinecomment-aside' )
			) {
				return;
			}
			sidenoteManager.renderUnselected();
		}
	);

	// VisualEditor does not reload the page on save; instead it simply modifies the DOM.
	mw.hook( 'postEdit' ).add( function () {
		if ( ve && ve.init && ve.init.articleTarget && ve.init.articleTarget.teardownUnloadHandlers ) {
			ve.init.articleTarget.teardownUnloadHandlers();
			location.replace( location.href );
		}
	});

} );
