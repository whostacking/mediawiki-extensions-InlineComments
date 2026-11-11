<?php

namespace MediaWiki\Extension\InlineComments\Api;

use LogicException;
use MediaWiki\Api\ApiBase;
use MediaWiki\Api\ApiMain;
use MediaWiki\CommentStore\CommentStoreComment;
use MediaWiki\Extension\InlineComments\AnnotationContent;
use MediaWiki\Extension\InlineComments\AnnotationContentHandler;
use MediaWiki\Page\WikiPageFactory;
use MediaWiki\Title\Title;
use Wikimedia\ParamValidator\ParamValidator;

class ApiDeleteReply extends ApiBase {

	private WikiPageFactory $wikiPageFactory;

	public function __construct(
		ApiMain $parent,
		string $name,
		WikiPageFactory $wpf
	) {
		$this->wikiPageFactory = $wpf;
		parent::__construct( $parent, $name );
	}

	public function execute() {
		$data = $this->extractRequestParams();
		$title = $this->getTitleFromTitleOrPageId( $data );
		if ( !$title || $title->getNamespace() < 0 ) {
			$this->dieWithError( 'inlinecomments-invalidtitle' );
		}

		$this->checkTitleUserPermissions( $title, 'inlinecomments-add' );

		$user = $this->getUser();

		$this->removeCommentFromTitle( $title, $data['id'], (int)$data['comment_idx'] );

		$result = $this->getResult();
		$result->addValue(
			null,
			$this->getModuleName(),
			[
				'success' => true,
			]
		);
	}

	private function removeCommentFromTitle( Title $title, string $id, int $commentIdx ): void {
		$wp = $this->wikiPageFactory->newFromTitle( $title );
		$pageUpdater = $wp->newPageUpdater( $this->getUser() );

		$prevRevision = $pageUpdater->grabParentRevision();
		if ( !$prevRevision ) {
			$this->dieWithError( 'inlinecomments-missingpage' );
		}

		if ( $prevRevision->hasSlot( AnnotationContent::SLOT_NAME ) ) {
			$content = $prevRevision->getContent( AnnotationContent::SLOT_NAME );
		} else {
			$content = ( new AnnotationContentHandler )->makeEmptyContent();
		}
		if ( !( $content instanceof AnnotationContent ) ) {
			throw new LogicException( 'Unexpected content type' );
		}

		if ( !$content->hasItem( $id ) ) {
			$this->dieWithError( 'inlinecomments-noitembyid' );
		}

		$user = $this->getUser();
		$newContent = $content->removeComment( $id, $commentIdx, $user, $title );

		$pageUpdater->setContent( AnnotationContent::SLOT_NAME, $newContent );
		$pageUpdater->addTag( 'inlinecomments' );
		$summary = CommentStoreComment::newUnsavedComment(
			$this->msg( 'inlinecomments-editsummary-delete' )
				->inContentLanguage()
		);
		$pageUpdater->saveRevision( $summary, EDIT_INTERNAL | EDIT_UPDATE );
		if ( !$pageUpdater->wasSuccessful() ) {
			$this->dieWithError( 'inlinecomments-saveerror' );
		}
	}

	public function needsToken() {
		return 'csrf';
	}

	public function isWriteMode() {
		return true;
	}

	public function getAllowedParams() {
		return [
			'title' => [
				ParamValidator::PARAM_TYPE => 'string',
			],
			'pageid' => [
				ParamValidator::PARAM_TYPE => 'string',
			],
			'id' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => 'string',
			],
			'comment_idx' => [
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_TYPE => 'integer',
			]
		];
	}
}
